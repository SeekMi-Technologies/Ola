// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Inject controlled dicts so tests don't depend on the real en.js / zh.js
// content shifting under us.
vi.mock('../translation/translation', () => ({
  default: {
    zh: {
      hello: '你好',
      'Add Item': '添加项目-quoted',
      add_item_normalized: '添加项目-snake',
      empty_value: '',
    },
    en: {
      hello: 'Hello',
      en_only: 'English Only',
      'Add Item': 'Add Item EN',
    },
  },
}));

// Drive lang via a single mutable so each test controls reducer state.
let mockLang = 'zh';
vi.mock('react-redux', async () => {
  const actual = await vi.importActual('react-redux');
  return {
    ...actual,
    useSelector: (selector) => selector({ lang: { current: mockLang } }),
  };
});

import useLanguage from '../useLanguage';

beforeEach(() => {
  mockLang = 'zh';
});

describe('useLanguage — lookup precedence', () => {
  test('exact raw-key hit in current-lang dict', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('hello')).toBe('你好');
  });

  test('quoted key with spaces resolves via exact lookup (before normalization)', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('Add Item')).toBe('添加项目-quoted');
  });

  test('normalized snake_case lookup catches inputs with mixed case / punctuation', () => {
    mockLang = 'zh';
    const { result } = renderHook(() => useLanguage());
    expect(result.current('Add Item Normalized')).toBe('添加项目-snake');
  });

  test('falls back to en when key missing from zh', () => {
    mockLang = 'zh';
    const { result } = renderHook(() => useLanguage());
    expect(result.current('en_only')).toBe('English Only');
  });

  test('falls back to en for quoted key missing in zh', () => {
    mockLang = 'en';
    const { result } = renderHook(() => useLanguage());
    expect(result.current('Add Item')).toBe('Add Item EN');
  });

  test('title-cases the raw key when both dicts miss', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('totally_unknown')).toBe('Totally Unknown');
  });

  test('empty-string translation value is honored (does not fall back)', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('empty_value')).toBe('');
  });
});

describe('useLanguage — null safety', () => {
  test('empty key returns empty string', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('')).toBe('');
  });

  test('null key returns empty string', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current(null)).toBe('');
  });

  test('undefined key returns empty string', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current(undefined)).toBe('');
  });

  test('numeric key is coerced and resolved via title-case fallback', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current(42)).toBe('42');
  });
});

describe('useLanguage — language selection', () => {
  test('lang switch: same key returns different translation per current lang', () => {
    mockLang = 'zh';
    const { result: zhResult } = renderHook(() => useLanguage());
    expect(zhResult.current('hello')).toBe('你好');

    mockLang = 'en';
    const { result: enResult } = renderHook(() => useLanguage());
    expect(enResult.current('hello')).toBe('Hello');
  });

  test('unknown lang code (e.g. tampered localStorage) falls through to en fallback', () => {
    mockLang = 'fr';
    const { result } = renderHook(() => useLanguage());
    expect(result.current('hello')).toBe('Hello');
  });

  test('null lang from selector → DEFAULT_LANG path → still resolves', () => {
    mockLang = null;
    const { result } = renderHook(() => useLanguage());
    expect(result.current('hello')).toBe('你好');
  });
});

describe('useLanguage — title-case fallback formatting', () => {
  test('underscores become spaces and each word is capitalized', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('multi_word_key')).toBe('Multi Word Key');
  });

  test('consecutive underscores collapse cleanly (no double spaces)', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('foo___bar')).toBe('Foo Bar');
  });

  test('leading underscore does not produce empty leading word', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current('_leading')).toBe('Leading');
  });
});
