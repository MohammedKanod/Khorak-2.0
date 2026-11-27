import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { LiveSyncStatus } from '../../components/LiveSyncStatus';
import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plus,
  PlusCircle,
  Send,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest, apiUrl } from '../../lib/api';
import {
  DiscrepancyCase,
  DispatchAppeal,
  DispatchRecord,
  Product,
  StockRequest,
} from '../../types';
import { EmptyState, KpiCard, LoadingSkeleton, ModalDialog, StatusBadge } from '../../components/ui';

type SupplierTab = 'dashboard' | 'create' | 'appeals' | 'history' | 'status' | 'profile';

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
  const [appeals, setAppeals] = useState<DispatchAppeal[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [centres, setCentres] = useState<TargetCentre[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create dispatch state
  const [destinationCentreId, setDestinationCentreId] = useState('');
  const [linkedStockRequestId, setLinkedStockRequestId] = useState<string | null>(null);
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<
    Array<{ productId: string; batchNumber: string; expiryDate: string; expectedQuantity: string }>
  >([]);
  const [submitting, setSubmitting] = useState(false);

  // Appeal response modal state
  const [respondAppealTarget, setRespondAppealTarget] = useState<DispatchAppeal | null>(null);
  const [supplierReplyText, setSupplierReplyText] = useState('');
  const [supplierReplyFile, setSupplierReplyFile] = useState<File | null>(null);

  async function fetchPortalData(background: boolean) {
    if (!background) setLoading(true);
    try {
      const [dRes, discRes, tRes, aplRes, reqRes] = await Promise.all([
        apiRequest<{ success: boolean; data: DispatchRecord[] }>('/api/dispatches'),
        apiRequest<{ success: boolean; data: DiscrepancyCase[] }>('/api/discrepancies'),
        apiRequest<{
          success: boolean;
          data: { centres: TargetCentre[]; products: Product[] };
        }>('/api/dispatches/targets'),
        apiRequest<{ success: boolean; data: DispatchAppeal[] }>('/api/appeals').catch(() => ({
          success: true,
          data: [] as DispatchAppeal[],
        })),
        apiRequest<{ success: boolean; data: StockRequest[] }>('/api/stock-requests').catch(() => ({
          success: true,
          data: [] as StockRequest[],
        })),
      ]);
      setDispatches(dRes.data);
      setDiscrepancies(discRes.data);
      setCentres(tRes.data.centres);
      setProducts(tRes.data.products);
      setAppeals(aplRes.data);
      setStockRequests(reqRes.data);

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
    } finally {
      setLoading(false);
    }
  }

  const liveSync = useLiveRefresh(fetchPortalData);
  const loadAll = () => liveSync.refresh();

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    const trimmedVehicleNumber = vehicleNumber.trim();
    if (!evidenceFile) {
      setBanner({
        type: 'error',
        text: 'Dispatch proof (Delivery Evidence / Challan) is required.',
      });
      return;
    }
    if (trimmedVehicleNumber.length < 3) {
      setBanner({
        type: 'error',
        text: 'Vehicle number is required.',
      });
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const form = new FormData();
      form.append('destinationCentreId', destinationCentreId);
      if (linkedStockRequestId) form.append('stockRequestId', linkedStockRequestId);
      form.append('dispatchDate', new Date(dispatchDate).toISOString());
      form.append('status', 'DISPATCHED');
      form.append('vehicleNumber', trimmedVehicleNumber);
      if (notes) form.append('notes', notes);
      form.append('evidence', evidenceFile);
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
      setVehicleNumber('');
      setNotes('');
      setEvidenceFile(null);
      if (evidenceInputRef.current) evidenceInputRef.current.value = '';
      setLinkedStockRequestId(null);
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

  async function handleRespondAppeal(e: React.FormEvent) {
    e.preventDefault();
    if (!respondAppealTarget) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const form = new FormData();
      form.append('supplierRemarks', supplierReplyText);
      if (supplierReplyFile) form.append('evidence', supplierReplyFile);

      await apiRequest(`/api/appeals/${respondAppealTarget.id}/respond`, {
        method: 'POST',
        body: form,
      });

      setRespondAppealTarget(null);
      setSupplierReplyText('');
      setSupplierReplyFile(null);
      await loadAll();
      setBanner({
        type: 'success',
        text: `Response submitted for Appeal ${respondAppealTarget.appealReference}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to respond to appeal',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function startDispatchForRequest(sr: StockRequest) {
    setLinkedStockRequestId(sr.id);
    setDestinationCentreId(sr.centreId);
    const qty = sr.approvedQuantity ?? sr.requestedQuantity;
    setNotes(`Fulfilling approved stock request ${sr.requestNumber}`);
    setItems([
      {
        productId: sr.productId,
        batchNumber: `GCM-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-REQ`,
        expiryDate: new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10),
        expectedQuantity: String(qty),
      },
    ]);
    setTab('create');
  }

  const deliveredCount = dispatches.filter((d) => d.status === 'DELIVERED').length;
  const pendingCount = dispatches.filter((d) => d.status === 'DISPATCHED').length;
  const discrepancyCount = dispatches.filter((d) => d.status === 'DISCREPANCY').length;
  const awaitingAppealsCount = appeals.filter(
    (a) => a.status === 'AWAITING_SUPPLIER_RESPONSE' || a.status === 'SUBMITTED'
  ).length;
  const pendingRequestsCount = stockRequests.filter((r) =>
    ['APPROVED', 'PARTIALLY_APPROVED', 'AWAITING_DISPATCH'].includes(r.status)
  ).length;

  const navItems: Array<{ id: SupplierTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: t('navDashboard'), icon: LayoutDashboard },
    { id: 'create', label: t('navCreateDispatch'), icon: PlusCircle },
    {
      id: 'appeals',
      label:
        awaitingAppealsCount + pendingRequestsCount > 0
          ? `Appeals & Requests (${awaitingAppealsCount + pendingRequestsCount})`
          : 'Appeals & Requests',
      icon: FileWarning,
    },
    { id: 'history', label: t('navDispatches'), icon: ClipboardList },
    { id: 'status', label: lang === 'gu' ? 'ડિલિવરી સ્થિતિ' : 'Delivery Status', icon: Truck },
    { id: 'profile', label: t('navProfile'), icon: User },
  ];

  return (
    <div className="supplier-shell min-h-screen bg-[var(--bg)] md:flex">
      {/* Sidebar */}
      <WorkspaceSidebar title="Supplier">
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
                aria-current={active ? 'page' : undefined}
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
      </WorkspaceSidebar>

      {/* Main Content */}
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="rounded-full bg-[var(--saffron-subtle)] px-2.5 py-0.5 text-xs font-bold text-[var(--warning)]">
                SUPPLY WORKSPACE
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

          <LiveSyncStatus {...liveSync} />

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
                  <section className="role-hero"><span className="role-eyebrow">Delivery operations</span><h2>Every delivery, accounted for.</h2><p>Plan consignments, follow deliveries and resolve exceptions across your assigned centres.</p></section>
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
                  {linkedStockRequestId && (
                    <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-[var(--success-subtle)] px-4 py-2.5 text-xs text-[var(--success)]">
                      <span>
                        Fulfilling Authorised Stock Request{' '}
                        <span className="font-mono-num font-bold">
                          {stockRequests.find((r) => r.id === linkedStockRequestId)?.requestNumber ||
                            linkedStockRequestId}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setLinkedStockRequestId(null)}
                        className="font-bold underline"
                      >
                        Unlink
                      </button>
                    </div>
                  )}
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
                      <label htmlFor="dispatch-proof" className="mb-1 block text-sm font-semibold">
                        Dispatch Proof / Challan (Image or PDF){' '}
                        <span className="text-[var(--danger)]" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <input
                        id="dispatch-proof"
                        ref={evidenceInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                        className="k-input py-2 text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="dispatch-vehicle-number" className="mb-1 block text-sm font-semibold">
                        Vehicle Number{' '}
                        <span className="text-[var(--danger)]" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <input
                        id="dispatch-vehicle-number"
                        type="text"
                        value={vehicleNumber}
                        onChange={(e) => setVehicleNumber(e.target.value)}
                        placeholder="e.g., GJ-17-AB-1234"
                        className="k-input"
                        required
                        minLength={3}
                        maxLength={40}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="dispatch-notes" className="mb-1 block text-sm font-semibold">
                      Consignment Notes
                    </label>
                    <input
                      id="dispatch-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Seal ID or remarks (optional)"
                      className="k-input"
                    />
                  </div>

                  <button type="submit" disabled={submitting} className="k-btn-primary">
                    {submitting ? t('loading') : 'Generate Reference & Submit Dispatch'}
                  </button>
                </form>
              )}

              {tab === 'appeals' && (
                <div className="space-y-4">
                  {/* Approved Stock Requests Ready for Dispatch */}
                  <div className="k-card p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-base font-bold">
                        <PackagePlus className="h-4 w-4 text-[var(--accent)]" />
                        Authorised Stock Requests ({stockRequests.length})
                      </h2>
                      <StatusBadge variant={pendingRequestsCount > 0 ? 'warning' : 'normal'}>
                        {pendingRequestsCount} Awaiting Dispatch
                      </StatusBadge>
                    </div>
                    {stockRequests.length === 0 ? (
                      <EmptyState
                        title="No authorised stock requests"
                        description="Approved AWC replenishment requests from Supervisors appear here for dispatch."
                      />
                    ) : (
                      <div className="space-y-2.5">
                        {stockRequests.map((sr) => {
                          const canFulfill = ['APPROVED', 'PARTIALLY_APPROVED', 'AWAITING_DISPATCH'].includes(
                            sr.status
                          );
                          return (
                            <div
                              key={sr.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3.5 text-sm"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono-num font-bold">{sr.requestNumber}</span>
                                  <StatusBadge
                                    variant={
                                      sr.status === 'COMPLETED' || sr.status === 'DISPATCHED'
                                        ? 'normal'
                                        : 'warning'
                                    }
                                  >
                                    {sr.status}
                                  </StatusBadge>
                                </div>
                                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                  {sr.centre?.name} ({sr.centre?.code}) • {sr.product?.name} — Authorised:{' '}
                                  <span className="font-mono-num font-bold">
                                    {sr.approvedQuantity ?? sr.requestedQuantity} {sr.product?.unit}
                                  </span>
                                </p>
                                {sr.reviewRemarks && (
                                  <p className="mt-0.5 text-xs italic text-[var(--text-muted)]">
                                    Supervisor: {sr.reviewRemarks}
                                  </p>
                                )}
                              </div>
                              {canFulfill && (
                                <button
                                  type="button"
                                  onClick={() => startDispatchForRequest(sr)}
                                  className="k-btn-primary min-h-[38px] px-3 py-1.5 text-xs"
                                >
                                  <Truck className="h-3.5 w-3.5" /> Dispatch Order
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Supervisor Dispatch Appeals */}
                  <div className="k-card p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-base font-bold text-[var(--danger)]">
                        <FileWarning className="h-4 w-4" />
                        Supervisor Dispatch Appeals ({appeals.length})
                      </h2>
                      <StatusBadge variant={awaitingAppealsCount > 0 ? 'critical' : 'normal'}>
                        {awaitingAppealsCount} Need Response
                      </StatusBadge>
                    </div>
                    {appeals.length === 0 ? (
                      <EmptyState
                        title="No dispatch appeals"
                        description="Formal delivery shortage/damage appeals raised by Supervisors appear here."
                      />
                    ) : (
                      <div className="space-y-3">
                        {appeals.map((a) => {
                          const canRespond =
                            a.status === 'AWAITING_SUPPLIER_RESPONSE' || a.status === 'SUBMITTED';
                          return (
                            <div
                              key={a.id}
                              className="rounded-xl border border-[var(--border)] p-4 text-sm"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <span className="font-mono-num font-bold">{a.appealReference}</span>
                                  <span className="mx-2 text-[var(--text-muted)]">•</span>
                                  <span>{a.dispatch?.dispatchReference}</span>
                                  <span className="mx-2 text-[var(--text-muted)]">•</span>
                                  <span className="font-semibold">{a.centre?.name}</span>
                                </div>
                                <StatusBadge
                                  variant={
                                    a.status === 'RESOLVED'
                                      ? 'normal'
                                      : canRespond || a.status === 'ESCALATED'
                                        ? 'critical'
                                        : 'warning'
                                  }
                                >
                                  {a.status}
                                </StatusBadge>
                              </div>
                              <p className="font-mono-num mt-1 text-xs text-[var(--text-secondary)]">
                                Dispatched: {a.dispatchedQuantity} | Received: {a.receivedQuantity} | Damaged:{' '}
                                {a.damagedQuantity} | Missing: {a.missingQuantity}
                              </p>
                              <p className="mt-1.5 text-xs text-[var(--text-primary)]">
                                <span className="font-semibold">Supervisor Appeal:</span> {a.supervisorRemarks}
                              </p>
                              {a.evidenceUrl && (
                                <a
                                  href={apiUrl(a.evidenceUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-xs font-semibold text-[var(--accent)] underline"
                                >
                                  View Supervisor Evidence
                                </a>
                              )}
                              {a.supplierRemarks && (
                                <p className="mt-1 text-xs text-[var(--accent)]">
                                  <span className="font-semibold">Your Response:</span> {a.supplierRemarks}
                                </p>
                              )}
                              {a.resolutionRemarks && (
                                <p className="mt-1 text-xs italic text-[var(--text-secondary)]">
                                  Final Resolution: {a.resolutionRemarks}
                                </p>
                              )}
                              {canRespond && (
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRespondAppealTarget(a);
                                      setSupplierReplyText('');
                                      setSupplierReplyFile(null);
                                    }}
                                    className="k-btn-saffron min-h-[38px] px-3 py-1.5 text-xs"
                                  >
                                    <Send className="h-3.5 w-3.5" /> Submit Formal Response
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
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
                              {d.vehicleNumber && (
                                <>
                                  <span className="mx-2 text-[var(--text-muted)]">•</span>
                                  <span className="font-mono-num text-xs text-[var(--text-secondary)]">
                                    Vehicle: {d.vehicleNumber}
                                  </span>
                                </>
                              )}
                              {d.evidenceUrl && (
                                <>
                                  <span className="mx-2 text-[var(--text-muted)]">•</span>
                                  <a
                                    href={apiUrl(d.evidenceUrl)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-semibold text-[var(--accent)] underline"
                                  >
                                    Dispatch Proof
                                  </a>
                                </>
                              )}
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

      <ModalDialog
        open={Boolean(respondAppealTarget)}
        onClose={() => setRespondAppealTarget(null)}
        title="Respond to Dispatch Appeal"
        subtitle={respondAppealTarget?.appealReference}
      >
        <form onSubmit={handleRespondAppeal} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Supplier Explanation / Credit Note Action</label>
            <textarea
              rows={3}
              value={supplierReplyText}
              onChange={(e) => setSupplierReplyText(e.target.value)}
              className="k-textarea"
              required
              minLength={5}
              placeholder="Explain weighbridge challan / batch inspection or replacement commitment..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Supporting Challan / Photo (Optional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setSupplierReplyFile(e.target.files?.[0] || null)}
              className="k-input py-2 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRespondAppealTarget(null)}
              className="k-btn-secondary flex-1"
            >
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Submit Supplier Response'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}

