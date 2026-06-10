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

  const isAuthPath = ['/login', '/signup', '/register', '/forgetpassword', '/resetpassword'].some(
    (p) => window.location.pathname === p || window.location.pathname.startsWith(p + '/')
  );

  if ((!isLoggedIn && !bypassAuth) || isAuthPath) {
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

