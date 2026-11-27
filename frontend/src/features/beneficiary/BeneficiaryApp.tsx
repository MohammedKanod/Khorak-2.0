import { LogOut, Wheat } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { RationHistory } from './RationHistory';
export function BeneficiaryApp() {
  const { user, logout } = useAuth();
  return <div className="family-shell beneficiary-shell"><header className="family-header"><div className="brand-lockup"><span className="brand-symbol"><Wheat size={23} /></span><span><strong>KHORAK</strong><small>Beneficiary portal · {user?.name}</small></span></div><button className="k-btn-secondary" onClick={logout}><LogOut size={18} /><span>Sign out</span></button></header><main className="family-main"><RationHistory /></main></div>;
}
