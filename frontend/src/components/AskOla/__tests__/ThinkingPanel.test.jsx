// @vitest-environment jsdom
//
// Tests for ThinkingPanel (Issue #131, backlog L4).
//
// Component reads Redux lang via useLanguage hook for the localized
// "Ola is working on it..." / "View thinking process" fallback copy.
// We mock useLanguage to keep these tests Provider-free.

import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/locale/useLanguage', () => ({
  default: () => (key) => {
    const en = {
      'Ola is working on it...': 'Ola is working on it...',
      'View thinking process': 'View thinking process',
    };
    return en[key] || key;
  },
}));

import ThinkingPanel from '../ThinkingPanel';

// vitest doesn't run @testing-library auto-cleanup like jest does, so DOM
// from previous tests would leak and break getByRole('button') etc.
afterEach(cleanup);

describe('ThinkingPanel — live mode', () => {
  test('renders the currentLabel passed in', () => {
    const { getByText } = render(
      <ThinkingPanel mode="live" currentLabel="Ola is searching your products..." />
    );
    expect(getByText('Ola is searching your products...')).toBeTruthy();
  });

  test('falls back to "Working on it..." when currentLabel is null', () => {
    const { getByText } = render(<ThinkingPanel mode="live" currentLabel={null} />);
    expect(getByText('Ola is working on it...')).toBeTruthy();
  });

  test('falls back to "Working on it..." when currentLabel omitted entirely', () => {
    const { getByText } = render(<ThinkingPanel mode="live" />);
    expect(getByText('Ola is working on it...')).toBeTruthy();
  });

  test('renders a spinning loading icon', () => {
    const { container } = render(
      <ThinkingPanel mode="live" currentLabel="..." />
    );
    // AntD LoadingOutlined renders as <span> with `anticon-loading` class.
    expect(container.querySelector('.anticon-loading')).toBeTruthy();
  });

  test('does NOT show the View thinking process toggle in live mode', () => {
    const { queryByText } = render(
      <ThinkingPanel mode="live" currentLabel="..." />
    );
    expect(queryByText(/View thinking process/)).toBeNull();
  });
});

describe('ThinkingPanel — collapsed mode', () => {
  const sampleSteps = [
    { label: 'Ola is thinking...', ts: 1000 },
    { label: 'Ola is searching your products...', ts: 1100 },
    { label: 'Drafting your quote...', ts: 1200 },
  ];

  test('renders nothing when steps is empty', () => {
    const { container } = render(<ThinkingPanel mode="collapsed" steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when steps prop omitted', () => {
    const { container } = render(<ThinkingPanel mode="collapsed" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when steps is not an array (defensive)', () => {
    const { container } = render(<ThinkingPanel mode="collapsed" steps={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('default folded: shows toggle, hides step list', () => {
    const { getByRole, queryByText } = render(
      <ThinkingPanel mode="collapsed" steps={sampleSteps} />
    );
    const toggle = getByRole('button');
    expect(toggle.textContent).toMatch(/View thinking process/);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Steps should not be visible while folded.
    expect(queryByText('Ola is thinking...')).toBeNull();
    expect(queryByText('Ola is searching your products...')).toBeNull();
  });

  test('click toggle → expands and shows all steps in order', () => {
    const { getByRole, getByText, container } = render(
      <ThinkingPanel mode="collapsed" steps={sampleSteps} />
    );
    fireEvent.click(getByRole('button'));
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(getByText('Ola is thinking...')).toBeTruthy();
    expect(getByText('Ola is searching your products...')).toBeTruthy();
    expect(getByText('Drafting your quote...')).toBeTruthy();
    // Steps render as an ordered list — preserve user-visible order.
    const items = container.querySelectorAll('ol li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe('Ola is thinking...');
    expect(items[2].textContent).toBe('Drafting your quote...');
  });

  test('click toggle again → folds back', () => {
    const { getByRole, queryByText } = render(
      <ThinkingPanel mode="collapsed" steps={sampleSteps} />
    );
    const toggle = getByRole('button');
    fireEvent.click(toggle);
    expect(queryByText('Ola is thinking...')).toBeTruthy();
    fireEvent.click(toggle);
    expect(queryByText('Ola is thinking...')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ThinkingPanel — default mode is collapsed', () => {
  test('omitting mode prop → behaves as collapsed', () => {
    const { container } = render(<ThinkingPanel steps={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
