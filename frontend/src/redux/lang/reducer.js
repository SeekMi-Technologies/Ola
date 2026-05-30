import * as actionTypes from './types';
import * as authActionTypes from '@/redux/auth/types';

export const SUPPORTED = ['zh', 'en'];
export const DEFAULT_LANG = 'zh';

const INITIAL_STATE = { current: DEFAULT_LANG };

const langReducer = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case actionTypes.LANG_SET:
      if (!SUPPORTED.includes(action.payload)) return state;
      return { current: action.payload };

    // On login/profile-update success, adopt the user's saved Admin.language
    // when it diverges from current. Login can land before our toggle has
    // touched state, so this is the path that hydrates lang from the server.
    case authActionTypes.REQUEST_SUCCESS: {
      const userLang = action.payload?.language;
      if (SUPPORTED.includes(userLang) && userLang !== state.current) {
        return { current: userLang };
      }
      return state;
    }

    default:
      return state;
  }
};

export default langReducer;
