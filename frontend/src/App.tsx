import React, { Suspense, lazy } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { LoadingSkeleton } from './components/ui';

// Each portal (and its heavy deps such as recharts / jsqr) is split into its own
// chunk so the login page doesn't have to download all three before it can render.
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

  if (loading) {
    return <PageFallback />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={<PageFallback />}>
      {user.role === 'AWW' || user.role === 'AWH' ? (
        <AwwApp />
      ) : user.role === 'SUPPLIER' ? (
        <SupplierPortal />
      ) : (
        <AdminPortal />
      )}
    </Suspense>
  );
}

export default App;
