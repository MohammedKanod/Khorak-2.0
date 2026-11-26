import { useState } from 'react';
import { LockKeyhole, LogOut, Package } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest } from '../../lib/api';
import { ProductInventorySummary } from '../../types';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { LiveSyncStatus } from '../../components/LiveSyncStatus';
import { LoadingSkeleton, EmptyState } from '../../components/ui';

export function HelperApp() {
  const { user, logout } = useAuth();
  const { lang, setLang } = useI18n();
  const [products, setProducts] = useState<ProductInventorySummary[] | null>(null);
  const sync = useLiveRefresh(async () => {
    const res = await apiRequest<{ data: { products: ProductInventorySummary[] } }>(`/api/inventory/${user!.centreId}`);
    setProducts(res.data.products);
  });
  const gu = lang === 'gu';
  return <div className="min-h-screen bg-[var(--bg)]">
    <header className="border-b border-[var(--border)] bg-white"><div className="mx-auto flex max-w-2xl items-center justify-between p-4">
      <span className="font-display text-xl font-bold text-[var(--accent)]">ખોરાક · KHORAK</span>
      <div className="flex gap-2"><button className="k-btn-secondary" onClick={() => setLang(gu ? 'en' : 'gu')}>{gu ? 'EN' : 'ગુજ'}</button><button className="k-btn-secondary" aria-label="Sign out" onClick={logout}><LogOut size={18} /></button></div>
    </div></header>
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <section className="role-hero"><span className="role-eyebrow">AWH · {gu ? 'સહાયક' : 'Centre helper'}</span><h1>{gu ? 'તમારા કેન્દ્રનો સ્ટોક' : 'Your centre stock'}</h1><p>{user?.centre?.name} · {user?.centre?.code}</p><div className="mt-5 flex items-center gap-2 text-sm"><LockKeyhole size={16} />{gu ? 'ફક્ત જોવા માટે. ફેરફાર માટે આંગણવાડી કાર્યકરનો સંપર્ક કરો.' : 'View only. Contact your Anganwadi Worker for stock corrections.'}</div></section>
      <LiveSyncStatus {...sync} />
      {!products ? <LoadingSkeleton rows={3} /> : products.length === 0 ? <EmptyState title="No stock records" description="Your worker will record stock received at this centre." /> : products.map(product => <article className="k-card p-5" key={product.productId}>
        <div className="flex items-center gap-3"><Package className="text-[var(--accent)]" size={22} /><h2 className="font-semibold">{gu ? product.productNameGu : product.productName}</h2></div>
        <p className="mt-4 text-3xl font-bold">{product.usableStock} <span className="text-base font-normal text-[var(--text-secondary)]">{product.unit}</span></p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{gu ? 'ઉપયોગી સ્ટોક' : 'Usable stock'} · {product.daysOfStock === null ? (gu ? 'દિવસનો અંદાજ ઉપલબ્ધ નથી' : 'Days of cover unavailable') : `${product.daysOfStock} ${gu ? 'દિવસ બાકી' : 'days of cover'}`}</p>
        {product.reorderLevel !== 'NORMAL' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{gu ? 'સ્ટોક ઓછો છે — કાર્યકરને જાણ કરો.' : 'Low stock — notify your Anganwadi Worker.'}</p>}
      </article>)}
    </main>
  </div>;
}
