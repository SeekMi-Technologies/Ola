import { describe, test, expect } from 'vitest';
import langReducer, { DEFAULT_LANG } from '../reducer';
import * as actionTypes from '../types';
import * as authActionTypes from '../../auth/types';

describe('lang reducer', () => {
  test('initial state is DEFAULT_LANG', () => {
    const state = langReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ current: DEFAULT_LANG });
  });

  test('LANG_SET with supported value updates current', () => {
    const state = langReducer({ current: 'zh' }, { type: actionTypes.LANG_SET, payload: 'en' });
    expect(state.current).toBe('en');
  });

  test('LANG_SET with unsupported value is rejected', () => {
    const prev = { current: 'zh' };
    const state = langReducer(prev, { type: actionTypes.LANG_SET, payload: 'fr' });
    expect(state).toBe(prev);
  });

  test('AUTH_REQUEST_SUCCESS adopts payload.language when supported and divergent', () => {
    const state = langReducer(
      { current: 'zh' },
      { type: authActionTypes.REQUEST_SUCCESS, payload: { language: 'en' } }
    );
    expect(state.current).toBe('en');
  });

  test('AUTH_REQUEST_SUCCESS without language leaves state unchanged', () => {
    const prev = { current: 'zh' };
    const state = langReducer(prev, { type: authActionTypes.REQUEST_SUCCESS, payload: {} });
    expect(state).toBe(prev);
  });

  test('AUTH_REQUEST_SUCCESS with same language is a no-op (identity preserved)', () => {
    const prev = { current: 'en' };
    const state = langReducer(prev, { type: authActionTypes.REQUEST_SUCCESS, payload: { language: 'en' } });
    expect(state).toBe(prev);
  });

  test('unknown action returns prev state by identity', () => {
    const prev = { current: 'en' };
    const state = langReducer(prev, { type: 'SOMETHING_ELSE' });
    expect(state).toBe(prev);
  });
});
