import { combineReducers } from 'redux';

import { reducer as authReducer } from './auth';
import { reducer as crudReducer } from './crud';
import { reducer as erpReducer } from './erp';
import { reducer as adavancedCrudReducer } from './adavancedCrud';
import { reducer as settingsReducer } from './settings';
import { reducer as langReducer } from './lang';

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
const rootReducer = (state, action) => {
  if (action.type === 'AUTH_LOGOUT_SUCCESS') {
    state = undefined;
  }
  return combinedReducer(state, action);
};

export default rootReducer;
