// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import rootReducer from '@/redux/rootReducer';

const mockGet = vi.fn();
const mockCreate = vi.fn();

vi.mock('@/request', () => ({
  request: {
    get: (...args) => mockGet(...args),
    create: (...args) => mockCreate(...args),
  },
}));

import EntityTrail from '../index';

const makeStore = ({ currentItem = null } = {}) =>
  configureStore({
    reducer: rootReducer,
    preloadedState: {
      lang: { current: 'en' },
      crud: {
        current: currentItem ? { result: currentItem } : null,
      },
    },
  });

import { CrudContextProvider } from '@/context/crud';

const renderEntityTrail = ({ currentItem = null, entityType = 'Client' } = {}) => {
  const store = makeStore({ currentItem });
  const utils = render(
    <Provider store={store}>
      <CrudContextProvider>
        <EntityTrail entityType={entityType} />
      </CrudContextProvider>
    </Provider>
  );
  return { ...utils, store };
};

beforeEach(() => {
  mockGet.mockReset();
  mockCreate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EntityTrail Component', () => {
  test('rendering nothing when no currentItem (empty ID placeholder)', () => {
    renderEntityTrail({ currentItem: null });
    expect(screen.getByTestId('empty-id-placeholder')).toBeDefined();
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('rendering empty notes state when list is empty', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      result: [],
    });

    renderEntityTrail({
      currentItem: { _id: 'client_id_123', name: 'Test Client' },
    });

    // Divider should render
    expect(screen.getByTestId('notes-divider')).toBeDefined();
    
    // Wait for trails query to resolve
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('no-notes-empty')).toBeDefined();
    expect(screen.getByTestId('note-input')).toBeDefined();
    expect(screen.getByTestId('note-submit-btn').hasAttribute('disabled')).toBe(true);
  });

  test('rendering list of trails with correct tags and content', async () => {
    const mockTrails = [
      {
        _id: 'trail_1',
        entityType: 'Client',
        entity: 'client_id_123',
        body: 'This is an agent note',
        source: 'agent',
        createdAt: '2026-05-22T14:30:00Z',
      },
      {
        _id: 'trail_2',
        entityType: 'Client',
        entity: 'client_id_123',
        body: 'This is a manual note',
        source: 'manual',
        createdBy: { _id: 'admin_1', name: 'Andy' },
        createdAt: '2026-05-20T09:15:00Z',
      },
    ];

    mockGet.mockResolvedValueOnce({
      success: true,
      result: mockTrails,
    });

    renderEntityTrail({
      currentItem: { _id: 'client_id_123', name: 'Test Client' },
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('notes-timeline')).toBeDefined();
    expect(screen.getByText('This is an agent note')).toBeDefined();
    expect(screen.getByText('This is a manual note')).toBeDefined();
    expect(screen.getByText('Agent')).toBeDefined();
    expect(screen.getByText('Andy')).toBeDefined();
  });

  test('submitting a manual note and refetching list', async () => {
    // Initial fetch empty list
    mockGet.mockResolvedValueOnce({
      success: true,
      result: [],
    });

    const { store } = renderEntityTrail({
      currentItem: { _id: 'client_id_123', name: 'Test Client' },
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    // Mock create successful note
    mockCreate.mockResolvedValueOnce({
      success: true,
      result: {
        _id: 'trail_new',
        body: 'Newly submitted note',
        source: 'manual',
        createdAt: '2026-06-03T00:50:00Z',
      },
    });

    // Mock subsequent load post-submit
    mockGet.mockResolvedValueOnce({
      success: true,
      result: [
        {
          _id: 'trail_new',
          body: 'Newly submitted note',
          source: 'manual',
          createdAt: '2026-06-03T00:50:00Z',
        },
      ],
    });

    const input = screen.getByTestId('note-input');
    const submitBtn = screen.getByTestId('note-submit-btn');

    // Button should be disabled initially
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Type in input
    fireEvent.change(input, { target: { value: 'Newly submitted note' } });
    expect(submitBtn.hasAttribute('disabled')).toBe(false);

    // Click submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate).toHaveBeenCalledWith({
      entity: 'trail',
      jsonData: {
        entityType: 'Client',
        entity: 'client_id_123',
        body: 'Newly submitted note',
        source: 'manual',
      },
    });

    // Input should be cleared and fetch called again
    await waitFor(() => {
      expect(input.textContent).toBe('');
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByText('Newly submitted note')).toBeDefined();
  });
});
