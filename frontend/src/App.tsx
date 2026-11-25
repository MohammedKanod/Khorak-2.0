import React from 'react';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { AwwApp } from './features/aww/AwwApp';
import { SupplierPortal } from './features/supplier/SupplierPortal';
import { AdminPortal } from './features/admin/AdminPortal';
import { LoadingSkeleton } from './components/ui';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <LoadingSkeleton rows={4} />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (user.role === 'AWW' || user.role === 'AWH') {
    return <AwwApp />;
  }

  if (user.role === 'SUPPLIER') {
    return <SupplierPortal />;
  }

  return <AdminPortal />;
}

export default App;

