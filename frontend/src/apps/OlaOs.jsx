import { lazy, Suspense } from 'react';

import { useSelector } from 'react-redux';
import { Routes, Route, Navigate } from 'react-router-dom';
import { selectAuth } from '@/redux/auth/selectors';
import { AppContextProvider } from '@/context/appContext';
import PageLoader from '@/components/PageLoader';
import AuthRouter from '@/router/AuthRouter';
import Onboarding from '@/pages/Onboarding';
import Localization from '@/locale/Localization';

const ErpApp = lazy(() => import('./ErpApp'));

const DefaultApp = () => (
  <Localization>
    <AppContextProvider>
      <Suspense fallback={<PageLoader />}>
        <ErpApp />
      </Suspense>
    </AppContextProvider>
  </Localization>
);

export default function OlaOs() {
  const { isLoggedIn, current } = useSelector(selectAuth);

  // DEV ONLY: bypass login wall for UI development
  const bypassAuth = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

  const needsOnboarding = isLoggedIn && current?.onboarded === false;

  // 三层路由拦截:
  // 1. 未登录 → AuthRouter（Login / Register）
  // 2. 已登录 + 未上车 → /onboarding
  // 3. 已登录 + 已上车 → DefaultApp（ErpApp）

  if (!isLoggedIn && !bypassAuth) {
    return (
      <Localization>
        <AuthRouter />
      </Localization>
    );
  }

  if (needsOnboarding) {
    return (
      <Localization>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </Localization>
    );
  }

  return <DefaultApp />;
}

