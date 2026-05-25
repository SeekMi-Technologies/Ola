import { configureStore } from '@reduxjs/toolkit';

import rootReducer from './rootReducer';
import storePersist from './storePersist';
import { LANG_STORAGE_KEY } from './lang/actions';
import { SUPPORTED, DEFAULT_LANG } from './lang/reducer';

// localStorageHealthCheck();

const AUTH_INITIAL_STATE = {
  current: {},
  isLoggedIn: false,
  isLoading: false,
  isSuccess: false,
};

const auth_state = storePersist.get('auth') ? storePersist.get('auth') : AUTH_INITIAL_STATE;

// Precedence at cold-boot:
//   1. ola_lang (localStorage) — user explicitly toggled, highest priority
//   2. Admin.language (server-saved) — reflects past manual choice after login
//   3. Browser language — first-visit default
//   4. DEFAULT_LANG — absolute fallback if browser lang is unsupported
const readPersistedLang = () => {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch (e) {
    // localStorage unavailable (incognito / disabled)
  }
  return null;
};

const detectBrowserLang = () => {
  try {
    const browser = (navigator.language || '').toLowerCase();
    if (browser.startsWith('zh')) return 'zh';
    if (browser.startsWith('en')) return 'en';
  } catch (e) {
    // navigator unavailable (SSR / test env)
  }
  return DEFAULT_LANG;
};

const adminLang = auth_state.current?.language;
const langCurrent =
  readPersistedLang() ||
  (SUPPORTED.includes(adminLang) ? adminLang : null) ||
  detectBrowserLang();

const lang_state = { current: langCurrent };

const initialState = { auth: auth_state, lang: lang_state };

const store = configureStore({
  reducer: rootReducer,
  preloadedState: initialState,
  devTools: import.meta.env.PROD === false, // Enable Redux DevTools in development mode
});

export default store;
