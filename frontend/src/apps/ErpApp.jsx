import { useLayoutEffect } from 'react';
import { useEffect } from 'react';
import { selectAppSettings } from '@/redux/settings/selectors';
import { useDispatch, useSelector } from 'react-redux';

import { Layout } from 'antd';

import { useAppContext } from '@/context/appContext';

import Navigation from '@/apps/Navigation/NavigationContainer';

import HeaderContent from '@/apps/Header/HeaderContainer';
import PageLoader from '@/components/PageLoader';

import { settingsAction } from '@/redux/settings/actions';

import { selectSettings } from '@/redux/settings/selectors';

import AppRouter from '@/router/AppRouter';

// === MVP-HIDDEN: 侧弹 Ask Ola 面板本轮不需要（用左侧导航 Ask Ola 链接进主页面） ===
// import OlaChatPanel from '@/apps/OlaChatPanel/OlaChatPanel';
// === END MVP-HIDDEN ===

import useResponsive from '@/hooks/useResponsive';

import storePersist from '@/redux/storePersist';

import HistoryModal from '@/components/AskOla/HistoryModal';

export default function ErpCrmApp() {
  const { Content } = Layout;

  const { state: stateApp, appContextAction } = useAppContext();
  const { app } = appContextAction;
  // === MVP-HIDDEN: isOlaPanelOpen 仅供已隐藏的侧弹面板使用 ===
  const { isNavMenuClose, currentApp } = stateApp;
  // === END MVP-HIDDEN ===

  const { isMobile } = useResponsive();

  const dispatch = useDispatch();

  useLayoutEffect(() => {
    dispatch(settingsAction.list({ entity: 'setting' }));
  }, []);

  const appSettings = useSelector(selectAppSettings);

  const { isSuccess: settingIsloaded } = useSelector(selectSettings);

  useEffect(() => {
    const { loadDefaultLang } = storePersist.get('firstVisit');
    if (appSettings.idurar_app_language && !loadDefaultLang) {
      window.localStorage.setItem('firstVisit', JSON.stringify({ loadDefaultLang: true }));
    }
  }, [appSettings]);

  const bypassAuth = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

  if (settingIsloaded || bypassAuth)
    return (
      <Layout hasSider>
        <Navigation />
        <HistoryModal />

        {isMobile ? (
          <Layout style={{ marginLeft: 0 }}>
            <HeaderContent />
            <Content
              style={{
                margin: '0 auto',
                overflow: 'initial',
                width: '100%',
                padding: '0 10px',
                maxWidth: 'none',
              }}
            >
              <AppRouter />
            </Content>
          </Layout>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100vh', marginLeft: isNavMenuClose ? 60 : 220, transition: 'margin-left 0.2s' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <HeaderContent />
              <Content
                style={{
                  margin: '0 auto',
                  overflow: 'auto',
                  width: '100%',
                  padding: '0 10px',
                  maxWidth: 'none',
                  flex: 1,
                }}
              >
                <AppRouter />
              </Content>
            </div>
            {/* === MVP-HIDDEN: 侧弹 Ask Ola 面板本轮不需要 === */}
            {/* {isOlaPanelOpen && <OlaChatPanel />} */}
            {/* === END MVP-HIDDEN === */}
          </div>
        )}
      </Layout>
    );
  else return <PageLoader />;
}
