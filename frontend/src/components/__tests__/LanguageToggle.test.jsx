// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import rootReducer from '@/redux/rootReducer';

const mockPatch = vi.fn();
vi.mock('@/request', () => ({
  request: {
    patch: (...args) => mockPatch(...args),
  },
}));

const mockNotify = vi.fn();
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    notification: {
      ...actual.notification,
      warning: (...args) => mockNotify(...args),
    },
  };
});

import LanguageToggle from '../LanguageToggle';
import { setLang as setLangAction, LANG_STORAGE_KEY } from '@/redux/lang/actions';

const makeStore = ({ lang = 'zh', isLoggedIn = false, currentUser = {} } = {}) =>
  configureStore({
    reducer: rootReducer,
    preloadedState: {
      lang: { current: lang },
      auth: {
        current: currentUser,
        isLoggedIn,
        isLoading: false,
        isSuccess: false,
      },
    },
  });

const renderToggle = ({ lang, isLoggedIn, currentUser, variant } = {}) => {
  const store = makeStore({ lang, isLoggedIn, currentUser });
  const utils = render(
    <Provider store={store}>
      <LanguageToggle variant={variant} />
    </Provider>
  );
  return { ...utils, store };
};

// localStorage stub (jsdom 27 + Node 26 doesn't auto-provision)
const makeStorageStub = () => {
  const data = {};
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => { data[k] = String(v); }),
    removeItem: vi.fn((k) => { delete data[k]; }),
    clear: vi.fn(() => { Object.keys(data).forEach((k) => delete data[k]); }),
    _data: data,
  };
};

let storageStub;
beforeEach(() => {
  mockPatch.mockReset();
  mockNotify.mockReset();
  storageStub = makeStorageStub();
  Object.defineProperty(window, 'localStorage', { value: storageStub, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LanguageToggle — render + tooltip', () => {
  test('zh mode: aria-label points at en target, phrased in zh', () => {
    renderToggle({ lang: 'zh' });
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('切换到 English');
  });

  test('en mode: aria-label points at zh target, phrased in en', () => {
    renderToggle({ lang: 'en' });
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to 中文');
  });

  test('panel variant uses ola-panel-header-btn class', () => {
    renderToggle({ lang: 'zh', variant: 'panel' });
    expect(screen.getByRole('button').className).toContain('ola-panel-header-btn');
  });

  test('header variant (default) uses header-action-btn class', () => {
    renderToggle({ lang: 'zh' });
    expect(screen.getByRole('button').className).toContain('header-action-btn');
  });
});

describe('LanguageToggle — click flow', () => {
  test('not logged in: click flips redux lang + localStorage, skips PATCH', async () => {
    const { store } = renderToggle({ lang: 'zh', isLoggedIn: false });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(store.getState().lang.current).toBe('en'));
    expect(storageStub.setItem).toHaveBeenCalledWith(LANG_STORAGE_KEY, 'en');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('logged in success: flips redux + PATCH fires with target lang + syncs auth localStorage', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, result: { language: 'en' } });
    storageStub._data.auth = JSON.stringify({
      current: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
      isLoggedIn: true,
    });

    const { store } = renderToggle({
      lang: 'zh',
      isLoggedIn: true,
      currentUser: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
    });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith({
      entity: 'admin/profile/update',
      jsonData: { name: 'X', surname: 'Y', email: 'x@x.com', language: 'en' },
      silent: true,
    });
    expect(store.getState().lang.current).toBe('en');
    await waitFor(() => {
      const auth = JSON.parse(storageStub._data.auth);
      expect(auth.current.language).toBe('en');
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('logged in failure: shows warning notification, does NOT write auth localStorage', async () => {
    mockPatch.mockResolvedValueOnce({ success: false, message: 'boom' });
    storageStub._data.auth = JSON.stringify({
      current: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
      isLoggedIn: true,
    });

    renderToggle({
      lang: 'zh',
      isLoggedIn: true,
      currentUser: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
    });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(1));
    // Redux already flipped optimistically — translate now resolves in en
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Language saved on this device only',
      })
    );
    // auth.language stays old since backend save failed
    const auth = JSON.parse(storageStub._data.auth);
    expect(auth.current.language).toBe('zh');
  });

  test('rapid double-click: only the latest response applies (stale guard)', async () => {
    let resolveFirst, resolveSecond;
    mockPatch
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));

    storageStub._data.auth = JSON.stringify({
      current: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
      isLoggedIn: true,
    });

    const { store } = renderToggle({
      lang: 'zh',
      isLoggedIn: true,
      currentUser: { _id: 'a1', email: 'x@x.com', name: 'X', surname: 'Y', language: 'zh' },
    });

    fireEvent.click(screen.getByRole('button')); // zh → en (click 1)
    await waitFor(() => expect(store.getState().lang.current).toBe('en'));
    fireEvent.click(screen.getByRole('button')); // en → zh (click 2)
    await waitFor(() => expect(store.getState().lang.current).toBe('zh'));

    // Resolve in reverse order: click 1's response arrives AFTER click 2's
    resolveSecond({ success: true, result: { language: 'zh' } });
    await waitFor(() => {
      const auth = JSON.parse(storageStub._data.auth);
      expect(auth.current.language).toBe('zh');
    });

    // Now click 1's response arrives — should be IGNORED (stale)
    resolveFirst({ success: true, result: { language: 'en' } });
    await new Promise((r) => setTimeout(r, 10));
    const finalAuth = JSON.parse(storageStub._data.auth);
    expect(finalAuth.current.language).toBe('zh'); // unchanged by stale response
    expect(store.getState().lang.current).toBe('zh');
  });
});
