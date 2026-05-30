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

// Precedence at cold-boot: explicit toggle (localStorage) > Admin.language
// (from hydrated auth) > DEFAULT_LANG. Toggle wins so that a user who picked
// 'en' on the login screen sees 'en' even before the server profile loads.
const readPersistedLang = () => {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch (e) {
    // localStorage unavailable (incognito / disabled)
  }
  return null;
};

const adminLang = auth_state.current?.language;
const langCurrent =
  readPersistedLang() ||
  (SUPPORTED.includes(adminLang) ? adminLang : DEFAULT_LANG);

const lang_state = { current: langCurrent };

const initialState = { auth: auth_state, lang: lang_state };

const store = configureStore({
  reducer: rootReducer,
  preloadedState: initialState,
  devTools: import.meta.env.PROD === false, // Enable Redux DevTools in development mode
});

export default store;
