import React, { Suspense, lazy, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { LoadingSkeleton } from './components/ui';

// Each portal (and its heavy deps such as recharts / jsqr) is split into its own
// chunk so the login page doesn't have to download all three before it can render.
const BeneficiaryApp = lazy(() => import('./features/beneficiary/BeneficiaryApp').then(m => ({ default: m.BeneficiaryApp })));
const HelperApp = lazy(() => import('./features/helper/HelperApp').then(m => ({ default: m.HelperApp })));
const AwwApp = lazy(() =>
  import('./features/aww/AwwApp').then((m) => ({ default: m.AwwApp }))
);
const SupplierPortal = lazy(() =>
  import('./features/supplier/SupplierPortal').then((m) => ({ default: m.SupplierPortal }))
);
const AdminPortal = lazy(() =>
  import('./features/admin/AdminPortal').then((m) => ({ default: m.AdminPortal }))
);

function PageFallback() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <LoadingSkeleton rows={4} />
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
    StatusBar.setBackgroundColor({ color: '#1B4332' }).catch(() => undefined);
    SplashScreen.hide().catch(() => undefined);

    const listenerPromise = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        CapApp.minimizeApp().catch(() => undefined);
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove()).catch(() => undefined);
    };
  }, []);

  if (loading) {
    return <PageFallback />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={<PageFallback />}>
      {user.role === 'BENEFICIARY' ? <BeneficiaryApp key={user.id} /> : user.role === 'AWH' ? <HelperApp key={user.id} /> : user.role === 'AWW' ? (
        <AwwApp key={user.id} />
      ) : user.role === 'SUPPLIER' ? (
        <SupplierPortal key={user.id} />
      ) : (
        <AdminPortal key={user.id} />
      )}
    </Suspense>
  );
}

export default App;
