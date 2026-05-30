import * as actionTypes from './types';
import { SUPPORTED } from './reducer';

export const LANG_STORAGE_KEY = 'ola_lang';

export const setLang = (lang) => (dispatch) => {
  if (!SUPPORTED.includes(lang)) return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (e) {
    // localStorage may be unavailable (incognito / disabled); state still updates
  }
  dispatch({ type: actionTypes.LANG_SET, payload: lang });
};
