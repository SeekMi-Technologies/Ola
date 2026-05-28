import { combineReducers } from 'redux';

import { reducer as authReducer } from './auth';
import { reducer as crudReducer } from './crud';
import { reducer as erpReducer } from './erp';
import { reducer as adavancedCrudReducer } from './adavancedCrud';
import { reducer as settingsReducer } from './settings';
import { reducer as langReducer } from './lang';
import { LANG_STORAGE_KEY } from './lang/actions';
import { SUPPORTED } from './lang/reducer';

const combinedReducer = combineReducers({
  auth: authReducer,
  crud: crudReducer,
  erp: erpReducer,
  adavancedCrud: adavancedCrudReducer,
  settings: settingsReducer,
  lang: langReducer,
});

// 登出时把整棵 redux state 重置为初始值，避免上一个账号的列表 / 设置残留在内存里
// 被下一个登录账号看到（即使 localStorage 已清，内存中的 crud/settings 仍会显示旧数据）
// lang 单独保留：用户手动切换过语言（ola_lang 存在）时，登出后仍维持该选择
const rootReducer = (state, action) => {
  if (action.type === 'AUTH_LOGOUT_SUCCESS') {
    const storedLang = (() => {
      try { return window.localStorage.getItem(LANG_STORAGE_KEY); } catch (e) { return null; }
    })();
    const langCurrent = SUPPORTED.includes(storedLang) ? storedLang : null;
    state = langCurrent ? { lang: { current: langCurrent } } : undefined;
  }
  return combinedReducer(state, action);
};

export default rootReducer;
