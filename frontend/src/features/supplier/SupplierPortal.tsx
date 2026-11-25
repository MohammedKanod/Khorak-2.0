import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Plus,
  PlusCircle,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest } from '../../lib/api';
import { DiscrepancyCase, DispatchRecord, Product } from '../../types';
import { EmptyState, KpiCard, LoadingSkeleton, StatusBadge } from '../../components/ui';

type SupplierTab = 'dashboard' | 'create' | 'history' | 'status' | 'profile';

interface TargetCentre {
  id: string;
  name: string;
  nameGu: string | null;
  code: string;
  location: string;
  sector: { name: string; block: { name: string } };
}

export function SupplierPortal() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();

  const [tab, setTab] = useState<SupplierTab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyCase[]>([]);
  const [centres, setCentres] = useState<TargetCentre[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create dispatch state
  const [destinationCentreId, setDestinationCentreId] = useState('');
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [items, setItems] = useState<
    Array<{ productId: string; batchNumber: string; expiryDate: string; expectedQuantity: string }>
  >([]);
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [dRes, discRes, tRes] = await Promise.all([
        apiRequest<{ success: boolean; data: DispatchRecord[] }>('/api/dispatches'),
        apiRequest<{ success: boolean; data: DiscrepancyCase[] }>('/api/discrepancies'),
        apiRequest<{
          success: boolean;
          data: { centres: TargetCentre[]; products: Product[] };
        }>('/api/dispatches/targets'),
      ]);
      setDispatches(dRes.data);
      setDiscrepancies(discRes.data);
      setCentres(tRes.data.centres);
      setProducts(tRes.data.products);

      if (tRes.data.centres.length > 0 && !destinationCentreId) {
        setDestinationCentreId(tRes.data.centres[0].id);
      }
      if (tRes.data.products.length > 0 && items.length === 0) {
        const defaultExp = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
        setItems([
          {
            productId: tRes.data.products[0].id,
            batchNumber: `GCM-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-01`,
            expiryDate: defaultExp,
            expectedQuantity: '100',
          },
        ]);
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load supplier portal',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const form = new FormData();
      form.append('destinationCentreId', destinationCentreId);
      form.append('dispatchDate', new Date(dispatchDate).toISOString());
      form.append('status', 'DISPATCHED');
      if (notes) form.append('notes', notes);
      if (evidenceFile) form.append('evidence', evidenceFile);
      form.append(
        'items',
        JSON.stringify(
          items.map((i) => ({
            productId: i.productId,
            batchNumber: i.batchNumber,
            expiryDate: new Date(i.expiryDate).toISOString(),
            expectedQuantity: Number(i.expectedQuantity),
          }))
        )
      );

      const res = await apiRequest<{ success: boolean; data: DispatchRecord }>('/api/dispatches', {
        method: 'POST',
        body: form,
      });

      setBanner({
        type: 'success',
        text: `Dispatch ${res.data.dispatchReference} created and sent to destination AWC.`,
      });
      setNotes('');
      setEvidenceFile(null);
      setTab('history');
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create dispatch',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const deliveredCount = dispatches.filter((d) => d.status === 'DELIVERED').length;
  const pendingCount = dispatches.filter((d) => d.status === 'DISPATCHED').length;
  const discrepancyCount = dispatches.filter((d) => d.status === 'DISCREPANCY').length;

  const navItems: Array<{ id: SupplierTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: t('navDashboard'), icon: LayoutDashboard },
    { id: 'create', label: t('navCreateDispatch'), icon: PlusCircle },
    { id: 'history', label: t('navDispatches'), icon: ClipboardList },
    { id: 'status', label: lang === 'gu' ? 'ડિલિવરી સ્થિતિ' : 'Delivery Status', icon: Truck },
    { id: 'profile', label: t('navProfile'), icon: User },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] md:flex">
      {/* Sidebar */}
      <aside className="border-b border-[var(--border)] bg-[var(--accent)] text-white md:flex md:w-64 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-display text-lg font-bold">{t('appTitle')}</div>
            <p className="text-xs text-emerald-100">{user?.supplier?.name || 'Supplier Portal'}</p>
          </div>
          <button
            type="button"
            onClick={() => setLang(lang === 'gu' ? 'en' : 'gu')}
            className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-bold"
          >
            {lang === 'gu' ? 'EN' : 'ગુજ'}
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                  active ? 'bg-white text-[var(--accent)]' : 'text-emerald-100 hover:bg-white/10'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-white/15 p-4 md:block">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            <LogOut className="h-4 w-4" />
            {t('signOut')}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="rounded-full bg-[var(--saffron-subtle)] px-2.5 py-0.5 text-xs font-bold text-[var(--warning)]">
                GCMMFL SUPPLIER PORTAL
              </span>
              <h1 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
                {navItems.find((n) => n.id === tab)?.label}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setTab('create')}
              className="k-btn-primary"
            >
              <Plus className="h-4 w-4" />
              {t('navCreateDispatch')}
            </button>
          </div>

          {banner && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                banner.type === 'success'
                  ? 'border-emerald-200 bg-[var(--success-subtle)] text-[var(--success)]'
                  : 'border-red-200 bg-[var(--danger-subtle)] text-[var(--danger)]'
              }`}
            >
              {banner.text}
            </div>
          )}

          {loading ? (
            <LoadingSkeleton rows={5} />
          ) : (
            <>
              {tab === 'dashboard' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KpiCard label="Total Dispatches" value={dispatches.length} tone="green" />
                    <KpiCard label="In Transit / Pending" value={pendingCount} tone="saffron" />
                    <KpiCard label="Verified Delivered" value={deliveredCount} />
                    <KpiCard label="Discrepancy Cases" value={discrepancyCount} tone="danger" />
                  </div>

                  <div className="k-card p-5">
                    <h2 className="mb-3 text-base font-bold">Recent Dispatches</h2>
                    {dispatches.length === 0 ? (
                      <EmptyState
                        title="No dispatches created yet"
                        description="Create your first nutrition consignment dispatch to an Anganwadi Centre."
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                              <th className="py-2 pr-3">Reference</th>
                              <th className="py-2 pr-3">Destination AWC</th>
                              <th className="py-2 pr-3">Items</th>
                              <th className="py-2 pr-3">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dispatches.slice(0, 8).map((d) => (
                              <tr key={d.id} className="border-b border-[var(--border)]">
                                <td className="font-mono-num py-3 pr-3 font-semibold">
                                  {d.dispatchReference}
                                </td>
                                <td className="py-3 pr-3">
                                  <div className="font-medium">{d.destinationCentre.name}</div>
                                  <div className="text-xs text-[var(--text-muted)]">
                                    {d.destinationCentre.code}
                                  </div>
                                </td>
                                <td className="py-3 pr-3 text-xs">
                                  {d.items
                                    .map((i) => `${i.product.name} (${i.expectedQuantity} ${i.product.unit})`)
                                    .join(', ')}
                                </td>
                                <td className="py-3 pr-3">
                                  <StatusBadge
                                    variant={
                                      d.status === 'DELIVERED'
                                        ? 'normal'
                                        : d.status === 'DISCREPANCY'
                                          ? 'critical'
                                          : 'warning'
                                    }
                                  >
                                    {d.status}
                                  </StatusBadge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'create' && (
                <form onSubmit={handleCreateDispatch} className="k-card space-y-5 p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold">
                        Destination Anganwadi Centre
                      </label>
                      <select
                        value={destinationCentreId}
                        onChange={(e) => setDestinationCentreId(e.target.value)}
                        className="k-select"
                        required
                      >
                        {centres.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.code}) — {c.sector.block.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold">Dispatch Date</label>
                      <input
                        type="date"
                        value={dispatchDate}
                        onChange={(e) => setDispatchDate(e.target.value)}
                        className="k-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold">Dispatch Line Items & Batch Details</h2>
                      <button
                        type="button"
                        onClick={() => {
                          if (products.length === 0) return;
                          setItems((prev) => [
                            ...prev,
                            {
                              productId: products[0].id,
                              batchNumber: `GCM-${Date.now().toString().slice(-6)}`,
                              expiryDate: new Date(Date.now() + 90 * 86400000)
                                .toISOString()
                                .slice(0, 10),
                              expectedQuantity: '50',
                            },
                          ]);
                        }}
                        className="k-btn-secondary min-h-[36px] px-3 py-1 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Line Item
                      </button>
                    </div>

                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)]/50 p-3 md:grid-cols-5"
                      >
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-semibold">Product</label>
                          <select
                            value={item.productId}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, productId: e.target.value } : row
                                )
                              )
                            }
                            className="k-select text-sm"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                [{p.category}] {p.name} ({p.unit})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold">Batch Number</label>
                          <input
                            type="text"
                            value={item.batchNumber}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, batchNumber: e.target.value } : row
                                )
                              )
                            }
                            className="k-input text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold">Expiry Date</label>
                          <input
                            type="date"
                            value={item.expiryDate}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, expiryDate: e.target.value } : row
                                )
                              )
                            }
                            className="k-input text-sm"
                            required
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-semibold">Qty</label>
                            <input
                              type="number"
                              min="1"
                              step="0.5"
                              value={item.expectedQuantity}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, expectedQuantity: e.target.value } : row
                                  )
                                )
                              }
                              className="k-input text-sm"
                              required
                            />
                          </div>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                              aria-label="Remove item"
                              className="mb-1 rounded-lg border border-red-200 p-2.5 text-[var(--danger)] hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-semibold">
                        Delivery Evidence / Challan (Image or PDF)
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                        className="k-input py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold">Consignment Notes</label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Vehicle number, seal ID, or remarks"
                        className="k-input"
                      />
                    </div>
                  </div>

                  <button type="submit" disabled={submitting} className="k-btn-primary">
                    {submitting ? t('loading') : 'Generate Reference & Submit Dispatch'}
                  </button>
                </form>
              )}

              {(tab === 'history' || tab === 'status') && (
                <div className="space-y-4">
                  {discrepancies.length > 0 && (
                    <div className="k-card p-5">
                      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[var(--danger)]">
                        <AlertTriangle className="h-4 w-4" />
                        Delivery Discrepancies ({discrepancies.length})
                      </h2>
                      <div className="space-y-2.5">
                        {discrepancies.map((c) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/40 p-3 text-sm"
                          >
                            <div>
                              <p className="font-mono-num font-bold">
                                {c.dispatch?.dispatchReference} • {c.dispatch?.destinationCentre?.name}
                              </p>
                              <p className="text-xs text-[var(--text-secondary)]">
                                Expected: {c.expectedQuantity} | Accepted: {c.actualQuantity} |
                                Damaged: {c.damagedQuantity} | Missing: {c.missingQuantity}
                              </p>
                              {c.resolutionRemarks && (
                                <p className="mt-1 text-xs italic text-[var(--text-primary)]">
                                  Supervisor: {c.resolutionRemarks}
                                </p>
                              )}
                            </div>
                            <StatusBadge
                              variant={c.status === 'RESOLVED' || c.status === 'APPROVED' ? 'normal' : 'critical'}
                            >
                              {c.status}
                            </StatusBadge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="k-card p-5">
                    <h2 className="mb-3 text-base font-bold">All Dispatches & Acknowledgements</h2>
                    <div className="space-y-3">
                      {dispatches.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-xl border border-[var(--border)] p-4 text-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-mono-num font-bold">{d.dispatchReference}</span>
                              <span className="mx-2 text-[var(--text-muted)]">•</span>
                              <span className="font-semibold">{d.destinationCentre.name}</span>
                            </div>
                            <StatusBadge
                              variant={
                                d.status === 'DELIVERED'
                                  ? 'normal'
                                  : d.status === 'DISCREPANCY'
                                    ? 'critical'
                                    : 'warning'
                              }
                            >
                              {d.status}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                            {d.items.map((item) => (
                              <span
                                key={item.id}
                                className="rounded-md bg-[var(--bg-sunken)] px-2 py-1"
                              >
                                {item.product.name}: {item.expectedQuantity} {item.product.unit} (Batch{' '}
                                {item.batch.batchNumber})
                              </span>
                            ))}
                          </div>
                          {d.deliveryReceipt && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-[var(--success)]">
                              <CheckCircle2 className="h-4 w-4" />
                              <span>
                                Received {d.deliveryReceipt.acceptedQuantity} /{' '}
                                {d.deliveryReceipt.expectedQuantity} on{' '}
                                {new Date(d.deliveryReceipt.receivedAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'profile' && (
                <div className="k-card max-w-md space-y-3 p-6">
                  <h2 className="text-lg font-bold">{user?.name}</h2>
                  <p className="text-sm text-[var(--text-secondary)]">{user?.supplier?.name}</p>
                  <p className="font-mono-num text-xs text-[var(--text-muted)]">
                    Code: {user?.supplier?.code}
                  </p>
                  <button type="button" onClick={logout} className="k-btn-secondary mt-2 text-[var(--danger)]">
                    <LogOut className="h-4 w-4" />
                    {t('signOut')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

