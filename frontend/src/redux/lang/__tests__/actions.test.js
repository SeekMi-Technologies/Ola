// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLang, LANG_STORAGE_KEY } from '../actions';
import { LANG_SET } from '../types';

// jsdom 27 + Node 26 doesn't auto-provision localStorage; stub it per test.
const makeStorageStub = () => {
  const store = {};
  return {
    getItem: vi.fn((k) => (k in store ? store[k] : null)),
    setItem: vi.fn((k, v) => { store[k] = String(v); }),
    removeItem: vi.fn((k) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  };
};

describe('setLang action', () => {
  let stub;

  beforeEach(() => {
    stub = makeStorageStub();
    Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('dispatches LANG_SET and writes localStorage for supported value', () => {
    const dispatch = vi.fn();
    setLang('en')(dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: LANG_SET, payload: 'en' });
    expect(stub.setItem).toHaveBeenCalledWith(LANG_STORAGE_KEY, 'en');
  });

  test('no-op for unsupported value', () => {
    const dispatch = vi.fn();
    setLang('fr')(dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(stub.setItem).not.toHaveBeenCalled();
  });

  test('still dispatches when localStorage throws (incognito-style failure)', () => {
    stub.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const dispatch = vi.fn();
    setLang('zh')(dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: LANG_SET, payload: 'zh' });
  });
});
