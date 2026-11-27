import { BeneficiaryAccounts } from '../../components/BeneficiaryAccounts';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { MonthlyReport } from './MonthlyReport';
import { downloadCsv } from '../../lib/exportCsv';
import { officerRoles, OfficerRole } from './roleConfig';
import { HierarchyView } from './HierarchyView';
import { GovernancePanel, OperationalNote, SupplierProfile } from './GovernancePanel';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { LiveSyncStatus } from '../../components/LiveSyncStatus';
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileWarning,
  LayoutDashboard,
  LogOut,
  Package,
  PackagePlus,
  Search,
  Send,
  SlidersHorizontal,
  TrendingUp,
  Truck,
  UserCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../locales/translations';
import { apiRequest, apiUrl } from '../../lib/api';
import {
  AlertItem,
  BENEFICIARY_CATEGORY_OPTIONS,
  BeneficiaryReference,
  DiscrepancyCase,
  DispatchAppeal,
  DispatchRecord,
  EntitlementRule,
  ProductInventorySummary,
  ReconciliationRecord,
  SpoilageRecord,
  StockRequest,
} from '../../types';
import {
  EmptyState,
  KpiCard,
  LoadingSkeleton,
  ModalDialog,
  StatusBadge,
} from '../../components/ui';

type AdminTab =
  | 'hierarchy'
  | 'notes'
  | 'supply'
  | 'overview'
  | 'centres'
  | 'inventory'
  | 'stockRequests'
  | 'discrepancies'
  | 'reconciliation'
  | 'beneficiaries'
  | 'entitlements'
  | 'expiry'
  | 'alerts'
  | 'suppliers'
  | 'deliveries'
  | 'malnutrition'
  | 'reports';

interface BlockMetricsResponse {
  kpis: {
    totalCentres: number;
    totalUsableStock: number;
    centresBelowSevenDays: number;
    stockoutCentres: number;
    expiringBatchesCount: number;
    pendingDeliveries: number;
    deliveryFulfilmentPct: number;
    distributionEfficiencyPct: number;
    unresolvedDiscrepancies: number;
    activeAlertsCount: number;
  };
  blocks: Array<{
    blockId: string;
    blockName: string;
    centresCount: number;
    usableStock: number;
    stockoutCentres: number;
    lowStockCentres: number;
    distributedQty: number;
    receivedQty: number;
  }>;
  centres: Array<{
    centreId: string;
    centreName: string;
    centreNameGu: string | null;
    code: string;
    sectorId: string;
    sectorName: string;
    blockId: string;
    blockName: string;
    usableStock: number;
    expiringSoonBatches: number;
    hasStockout: boolean;
    hasLowStock: boolean;
    products: ProductInventorySummary[];
  }>;
  nutritionIndicators?: Array<{
    id: string;
    reportingPeriod: string;
    indicator: 'UNDERWEIGHT_PCT' | 'WASTING_PCT' | 'SAM_PCT';
    value: number;
    source: string;
    isSyntheticDemo: boolean;
    block: { id: string; name: string };
  }>;
  nutritionDataNotice?: string;
}

export function AdminPortal() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const role = user!.role as OfficerRole;
  const roleInfo = officerRoles[role];
  const canManage = !roleInfo.readOnly;
  const [notes, setNotes] = useState<OperationalNote[]>([]);
  const [supplierProfiles, setSupplierProfiles] = useState<SupplierProfile[]>([]);
  const [reqSupplierId, setReqSupplierId] = useState('');
  const isDistrictLevel = role === 'DPO' || role === 'DDO';

  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [blockFilter, setBlockFilter] = useState('ALL');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [metrics, setMetrics] = useState<BlockMetricsResponse | null>(null);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyCase[]>([]);
  const [spoilages, setSpoilages] = useState<SpoilageRecord[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryReference[]>([]);
  const [benReviewTarget, setBenReviewTarget] = useState<{
    beneficiary: BeneficiaryReference;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [benReviewRemarks, setBenReviewRemarks] = useState('');
  const [supplierPerf, setSupplierPerf] = useState<
    Array<{
      supplierId: string;
      supplierName: string;
      code: string;
      totalDispatches: number;
      deliveredCount: number;
      discrepancyCount: number;
      pendingCount: number;
      fulfilmentRatePct: number;
    }>
  >([]);
  const [distAnalytics, setDistAnalytics] = useState<{
    dailyTrend: Array<{ day: string; totalQuantity: number; count: number }>;
    byProduct: Array<{ productName: string; unit: string; totalQuantity: number; count: number }>;
  } | null>(null);

  // Supervisor Review Modal
  const [reviewCase, setReviewCase] = useState<DiscrepancyCase | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REQUEST_RECOUNT' | 'REJECT' | 'RESOLVE'>('RESOLVE');
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Physical Reconciliation Modal
  const [reconOpen, setReconOpen] = useState(false);
  const [reconCentreId, setReconCentreId] = useState('');
  const [reconProductId, setReconProductId] = useState('');
  const [reconBatchId, setReconBatchId] = useState('');
  const [reconPhysicalStock, setReconPhysicalStock] = useState('');
  const [reconRemarks, setReconRemarks] = useState('');

  // Approval Remarks Modal for Spoilage/Reconciliation
  const [approvalTarget, setApprovalTarget] = useState<{
    id: string;
    entityType: 'SPOILAGE' | 'RECONCILIATION';
    decision: 'approve' | 'reject';
    label: string;
  } | null>(null);
  const [approvalRemarks, setApprovalRemarks] = useState('');

  async function fetchPortalData(background: boolean) {
    if (!background) setLoading(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: {
          metrics: BlockMetricsResponse;
          discrepancies: DiscrepancyCase[];
          spoilages: SpoilageRecord[];
          reconciliations: ReconciliationRecord[];
          alerts: AlertItem[];
          dispatches: DispatchRecord[];
          supplierPerf: typeof supplierPerf;
          distAnalytics: NonNullable<typeof distAnalytics>;
          beneficiaries: BeneficiaryReference[];
          appeals?: DispatchAppeal[];
          stockRequests?: StockRequest[];
          entitlementRules?: EntitlementRule[];
        };
      }>('/api/dashboard/admin-bundle');

      const [noteResponse, supplierResponse] = await Promise.all([
        apiRequest<{ data: OperationalNote[] }>('/api/governance/notes'),
        apiRequest<{ data: SupplierProfile[] }>('/api/governance/suppliers'),
      ]);
      setNotes(noteResponse.data);
      setSupplierProfiles(supplierResponse.data);
      const bundle = res.data;
      setMetrics(bundle.metrics);
      setDiscrepancies(bundle.discrepancies);
      setSpoilages(bundle.spoilages);
      setReconciliations(bundle.reconciliations);
      setAlerts(bundle.alerts);
      setDispatches(bundle.dispatches);
      setSupplierPerf(bundle.supplierPerf);
      setDistAnalytics(bundle.distAnalytics);
      setBeneficiaries(bundle.beneficiaries);
      setAppeals(bundle.appeals || []);
      setStockRequests(bundle.stockRequests || []);
      setEntitlementRules(bundle.entitlementRules || []);

      if (bundle.metrics.centres.length > 0 && !reconCentreId) {
        const firstC = bundle.metrics.centres[0];
        setReconCentreId(firstC.centreId);
        const firstProd = firstC.products.find((p) => p.batches.length > 0) || firstC.products[0];
        if (firstProd) {
          setReconProductId(firstProd.productId);
          setReconBatchId(firstProd.batches[0]?.batchId || '');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const liveSync = useLiveRefresh(fetchPortalData);
  const loadDashboard = () => liveSync.refresh();

  const [appeals, setAppeals] = useState<DispatchAppeal[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [entitlementRules, setEntitlementRules] = useState<EntitlementRule[]>([]);
  const [editRuleTarget, setEditRuleTarget] = useState<EntitlementRule | null>(null);
  const [ruleProductId, setRuleProductId] = useState('');
  const [ruleMonthlyLimit, setRuleMonthlyLimit] = useState('');
  const [ruleWeightGrams, setRuleWeightGrams] = useState('');
  const [ruleWeightLabel, setRuleWeightLabel] = useState('');
  const [ruleIsConfigured, setRuleIsConfigured] = useState(true);
  const [ruleIsActive, setRuleIsActive] = useState(true);
  const [ruleNotes, setRuleNotes] = useState('');
  const [ruleAuditReason, setRuleAuditReason] = useState('');
  const [createAppealDisc, setCreateAppealDisc] = useState<DiscrepancyCase | null>(null);
  const [appealRemarksInput, setAppealRemarksInput] = useState('');
  const [appealFile, setAppealFile] = useState<File | null>(null);
  const [reviewAppealTarget, setReviewAppealTarget] = useState<DispatchAppeal | null>(null);
  const [appealDecision, setAppealDecision] = useState<'RESOLVED' | 'REJECTED' | 'ESCALATED' | 'UNDER_REVIEW'>('RESOLVED');
  const [appealDecisionRemarks, setAppealDecisionRemarks] = useState('');
  const [reviewReqTarget, setReviewReqTarget] = useState<StockRequest | null>(null);
  const [reqDecision, setReqDecision] = useState<'APPROVE' | 'PARTIAL_APPROVE' | 'REJECT'>('APPROVE');
  const [reqApprovedQty, setReqApprovedQty] = useState('');
  const [reqReviewRemarks, setReqReviewRemarks] = useState('');

  async function submitCreateAppeal(e: React.FormEvent) {
    e.preventDefault();
    if (!createAppealDisc) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('discrepancyCaseId', createAppealDisc.id);
      form.append('supervisorRemarks', appealRemarksInput);
      form.append('submitImmediately', 'true');
      if (appealFile) form.append('evidence', appealFile);
      await apiRequest('/api/appeals', { method: 'POST', body: form });
      setCreateAppealDisc(null);
      setAppealRemarksInput('');
      setAppealFile(null);
      await loadDashboard();
      setBanner({ type: 'success', text: 'Formal appeal submitted to Supplier.' });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Appeal submission failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAppealReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewAppealTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/appeals/${reviewAppealTarget.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision: appealDecision, remarks: appealDecisionRemarks }),
      });
      setReviewAppealTarget(null);
      setAppealDecisionRemarks('');
      await loadDashboard();
      setBanner({ type: 'success', text: `Appeal ${reviewAppealTarget.appealReference} updated (${appealDecision}).` });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Appeal review failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEntitlementRuleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editRuleTarget) return;
    setSubmitting(true);
    try {
      const parsedLimit =
        ruleIsConfigured && ruleMonthlyLimit.trim() !== '' ? Number(ruleMonthlyLimit) : null;
      const parsedGrams =
        ruleIsConfigured && ruleWeightGrams.trim() !== '' ? Number(ruleWeightGrams) : null;
      await apiRequest(`/api/entitlements/${encodeURIComponent(editRuleTarget.beneficiaryCategory)}`, {
        method: 'PUT',
        body: JSON.stringify({
          productId: ruleProductId || null,
          monthlyLimit: parsedLimit,
          packetWeightGrams: parsedGrams,
          packetWeightLabel: ruleIsConfigured && ruleWeightLabel.trim() ? ruleWeightLabel.trim() : null,
          isConfigured: ruleIsConfigured,
          isActive: ruleIsActive,
          notes: ruleNotes.trim() || undefined,
          reason: ruleAuditReason.trim(),
        }),
      });
      setEditRuleTarget(null);
      setRuleAuditReason('');
      await loadDashboard();
      setBanner({
        type: 'success',
        text: `Entitlement policy updated for ${editRuleTarget.beneficiaryCategory}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update entitlement rule',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitStockRequestReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewReqTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/stock-requests/${reviewReqTarget.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: reqDecision,
          assignedSupplierId: reqDecision !== 'REJECT' ? reqSupplierId : undefined,
          ...(reqDecision !== 'REJECT' && reqApprovedQty ? { approvedQuantity: Number(reqApprovedQty) } : {}),
          remarks: reqReviewRemarks,
        }),
      });
      setReviewReqTarget(null);
      setReqApprovedQty('');
      setReqReviewRemarks('');
      await loadDashboard();
      setBanner({ type: 'success', text: `Stock request ${reviewReqTarget.requestNumber} updated (${reqDecision}).` });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Stock request review failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDiscrepancyReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewCase) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/discrepancies/${reviewCase.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: reviewAction, remarks: reviewRemarks }),
      });
      setReviewCase(null);
      setReviewRemarks('');
      await loadDashboard();
      setBanner({ type: 'success', text: `Discrepancy case updated (${reviewAction}).` });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Review failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReconciliation(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/inventory/reconciliation', {
        method: 'POST',
        body: JSON.stringify({
          centreId: reconCentreId,
          productId: reconProductId,
          batchId: reconBatchId,
          physicalStock: Number(reconPhysicalStock),
          remarks: reconRemarks,
          autoApprove: role === 'SUPERVISOR' || role === 'CDPO',
        }),
      });
      setReconOpen(false);
      setReconPhysicalStock('');
      setReconRemarks('');
      await loadDashboard();
      setBanner({
        type: 'success',
        text: 'Physical stock verification recorded with compensating ledger event.',
      });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Reconciliation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitApprovalDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!approvalTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/approvals/${approvalTarget.id}/${approvalTarget.decision}`, {
        method: 'POST',
        body: JSON.stringify({
          entityType: approvalTarget.entityType,
          remarks: approvalRemarks,
        }),
      });
      setApprovalTarget(null);
      setApprovalRemarks('');
      await loadDashboard();
      setBanner({ type: 'success', text: `${approvalTarget.entityType} decision recorded.` });
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Approval action failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBeneficiaryReview(e: React.FormEvent) {
    e.preventDefault();
    if (!benReviewTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/beneficiaries/${benReviewTarget.beneficiary.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action: benReviewTarget.action,
          remarks: benReviewRemarks,
        }),
      });
      setBenReviewTarget(null);
      setBenReviewRemarks('');
      await loadDashboard();
      setBanner({
        type: 'success',
        text: `Beneficiary ${benReviewTarget.beneficiary.displayName} ${
          benReviewTarget.action === 'APPROVE' ? 'approved' : 'rejected'
        }.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Beneficiary review failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function exportCsvReport() {
    if (!metrics) return;
    downloadCsv(`khorak-inventory-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Centre Code', 'Centre', 'Sector', 'Block', 'Product', 'Unit', 'Usable stock', 'Days of cover', 'Reorder status', 'Expiring batches'],
      ...metrics.centres.flatMap(c => c.products.map(p => [c.code, c.centreName, c.sectorName, c.blockName, p.productName, p.unit, p.usableStock, p.daysOfStock, p.reorderLevel, p.expiringSoonBatches])),
    ]);
  }

  const navConfig: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: roleInfo.heading, icon: LayoutDashboard },
    { id: 'hierarchy', label: 'Hierarchy & access', icon: Building2 },
    { id: 'centres', label: isDistrictLevel ? 'Blocks & centres' : 'Sector & centre status', icon: Building2 },
    { id: 'inventory', label: 'Stock availability', icon: Package },
    { id: 'stockRequests', label: role === 'CDPO' ? 'Requests & approvals' : 'Stock requests', icon: PackagePlus },
    ...(role === 'CDPO' ? [{ id: 'supply' as AdminTab, label: 'Orders & supplier records', icon: Truck }] : []),
    { id: 'notes', label: role === 'SUPERVISOR' ? 'Inspections & flags' : isDistrictLevel ? 'Programme escalations' : 'Observations & flags', icon: FileWarning },
    ...(canManage ? [{ id: 'beneficiaries' as AdminTab, label: 'Beneficiary approvals', icon: UserCheck }, { id: 'reconciliation' as AdminTab, label: 'Verification & corrections', icon: ClipboardCheck }] : []),
    { id: 'discrepancies', label: 'Delivery exceptions', icon: FileWarning },
    { id: 'alerts', label: 'Supply alerts', icon: AlertTriangle },
    { id: 'deliveries', label: 'Deliveries', icon: Truck },
    { id: 'suppliers', label: 'Supplier performance', icon: TrendingUp },
    { id: 'expiry', label: 'Expiry monitoring', icon: Clock },
    ...(isDistrictLevel ? [{ id: 'malnutrition' as AdminTab, label: 'Nutrition trends', icon: TrendingUp }] : []),
    { id: 'entitlements', label: 'Entitlement rules', icon: SlidersHorizontal },
    { id: 'reports', label: 'Reports & exports', icon: Download },
  ];

  const filteredCentres = (metrics?.centres || []).filter((c) => {
    const matchesBlock = blockFilter === 'ALL' || c.blockId === blockFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesQ =
      !q ||
      c.centreName.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.sectorName.toLowerCase().includes(q);
    return matchesBlock && matchesQ;
  });

  const allBatches = (metrics?.centres || []).flatMap((c) =>
    c.products.flatMap((p) =>
      p.batches.map((b) => ({
        ...b,
        centreName: c.centreName,
        centreCode: c.code,
        blockName: c.blockName,
      }))
    )
  );

  const reconCentre = metrics?.centres.find((c) => c.centreId === reconCentreId);
  const reconProduct = reconCentre?.products.find((p) => p.productId === reconProductId);
  const reconBatch = reconProduct?.batches.find((b) => b.batchId === reconBatchId);

  // Transform NutritionAggregate into Recharts trend dataset
  const malnutritionByPeriod = (() => {
    const rows = metrics?.nutritionIndicators || [];
    const map = new Map<string, { period: string; underweight: number; wasting: number; sam: number; count: number }>();
    for (const r of rows) {
      const entry = map.get(r.reportingPeriod) || {
        period: r.reportingPeriod,
        underweight: 0,
        wasting: 0,
        sam: 0,
        count: 0,
      };
      if (r.indicator === 'UNDERWEIGHT_PCT') {
        entry.underweight += r.value;
        entry.count++;
      } else if (r.indicator === 'WASTING_PCT') {
        entry.wasting += r.value;
      } else if (r.indicator === 'SAM_PCT') {
        entry.sam += r.value;
      }
      map.set(r.reportingPeriod, entry);
    }
    return Array.from(map.values()).map((d) => ({
      period: d.period,
      underweightPct: d.count ? Number((d.underweight / d.count).toFixed(1)) : 0,
      wastingPct: d.count ? Number((d.wasting / d.count).toFixed(1)) : 0,
      samPct: d.count ? Number((d.sam / d.count).toFixed(1)) : 0,
    }));
  })();

  return (
    <div className="officer-shell min-h-screen bg-[var(--bg)] md:flex">
      {/* Sidebar */}
      <WorkspaceSidebar title={role}>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-display text-lg font-bold">{t('appTitle')}</div>
            <p className="text-xs text-emerald-100">
              {roleInfo.level} · {role} • {user?.block?.name || user?.sector?.name || user?.district?.name || 'Panchmahal'}
            </p>
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
          {navConfig.map((item) => {
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
          <p className="mb-2 truncate text-xs text-emerald-100">{user?.name}</p>
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

      {/* Main */}
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="rounded-full bg-[var(--saffron-subtle)] px-2.5 py-0.5 text-xs font-bold text-[var(--warning)]">
                {t('syntheticBanner')}
              </span>
              <h1 className="mt-3 text-2xl font-bold text-[var(--text-primary)]">
                {navConfig.find((n) => n.id === tab)?.label}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {role === 'SUPERVISOR' && (
                <button type="button" onClick={() => setReconOpen(true)} className="k-btn-primary">
                  <ClipboardCheck className="h-4 w-4" />
                  Physical Verification
                </button>
              )}
              <button type="button" onClick={exportCsvReport} className="k-btn-secondary">
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button type="button" onClick={logout} className="k-btn-secondary md:hidden">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

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

          {loading || !metrics ? (
            <LoadingSkeleton rows={5} />
          ) : (
            <>
              {tab === 'hierarchy' && <HierarchyView centres={metrics.centres} role={role} onOpenCentre={centre => { setSearchQuery(centre.code); setBlockFilter(centre.blockId); setTab('centres'); }} />}
              {(tab === 'notes' || tab === 'supply') && <GovernancePanel key={tab} mode={tab} role={role} centres={metrics.centres} notes={notes} suppliers={supplierProfiles} reload={loadDashboard} />}
              {/* OVERVIEW */}
              {tab === 'overview' && (
                <div className="space-y-6">
                  <section className="role-hero">
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="role-eyebrow">{roleInfo.level} · {user?.district?.name || user?.block?.name || user?.sector?.name}</span><span className="role-access">{roleInfo.readOnly ? 'View & export access' : 'Operational access'}</span></div>
                    <h2>{roleInfo.title}</h2><p>{roleInfo.purpose}</p>
                    <div className="mt-6 flex flex-wrap gap-3"><button className="hero-button" onClick={() => setTab(role === 'CDPO' ? 'supply' : role === 'SUPERVISOR' ? 'reconciliation' : 'centres')}>{role === 'CDPO' ? 'Issue a stock order' : role === 'SUPERVISOR' ? 'Verify centre stock' : 'Explore area performance'}</button><button className="hero-button-secondary" onClick={() => setTab('hierarchy')}>View hierarchy & responsibilities</button></div>
                  </section>
                  <section className="grid gap-3 sm:grid-cols-3" aria-label="Priority work">
                    <button className="priority-card" onClick={() => setTab('alerts')}><span className="priority-icon"><AlertTriangle size={20} /></span><strong>{metrics.kpis.stockoutCentres}</strong><span>Centres with stockouts</span><small>Review supply risks</small></button>
                    <button className="priority-card" onClick={() => setTab(role === 'CDPO' || role === 'SUPERVISOR' ? 'stockRequests' : 'discrepancies')}><span className="priority-icon"><ClipboardCheck size={20} /></span><strong>{canManage ? stockRequests.filter(r => ['SUBMITTED', 'PENDING_APPROVAL'].includes(r.status)).length : metrics.kpis.unresolvedDiscrepancies}</strong><span>{canManage ? 'Requests awaiting CDPO' : 'Unresolved delivery exceptions'}</span><small>{role === 'CDPO' ? 'Review & assign suppliers' : 'Inspect current status'}</small></button>
                    <button className="priority-card" onClick={() => setTab('notes')}><span className="priority-icon"><FileWarning size={20} /></span><strong>{notes.filter(n => n.kind === 'ANOMALY' || n.kind === 'SHORTAGE').length}</strong><span>Recorded programme flags</span><small>{canManage ? 'Record or review observations' : 'Review officer observations'}</small></button>
                  </section>
                  <section className="k-card p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">{isDistrictLevel ? 'Block performance at a glance' : 'Sector performance at a glance'}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Availability across your assigned area. Select a row to inspect centres.</p></div><span className="scope-chip">{metrics.kpis.totalCentres} centres</span></div>
                    <div className="mt-4 space-y-2">{(isDistrictLevel ? metrics.blocks.map(b => ({ id: b.blockId, name: b.blockName, total: b.centresCount, stockouts: b.stockoutCentres, query: '' })) : [...new Map(metrics.centres.map(c => [c.sectorId, c.sectorName])).entries()].map(([id, name]) => { const members = metrics.centres.filter(c => c.sectorId === id); return { id, name, total: members.length, stockouts: members.filter(c => c.hasStockout).length, query: name }; })).map(area => <button key={area.id} className="area-row" onClick={() => { setBlockFilter(isDistrictLevel ? area.id : 'ALL'); setSearchQuery(area.query); setTab('centres'); }}><span className="font-semibold">{area.name}</span><span className="text-sm text-[var(--text-secondary)]">{area.total} centres</span><span className="availability-bar"><span style={{ width: `${area.total ? (area.total - area.stockouts) / area.total * 100 : 0}%` }} /></span><span className={`text-sm ${area.stockouts ? 'text-red-700' : 'text-emerald-700'}`}>{area.stockouts} stockouts</span></button>)}</div>
                  </section>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                    <KpiCard label="Registered Centres" value={metrics.kpis.totalCentres} tone="green" />
                    <KpiCard label="Sectors in Scope" value={new Set(metrics.centres.map(c => c.sectorId)).size} />
                    <KpiCard
                      label="Below 7 Days Stock"
                      value={metrics.kpis.centresBelowSevenDays}
                      tone="saffron"
                    />
                    <KpiCard
                      label="Stockout Centres"
                      value={metrics.kpis.stockoutCentres}
                      tone="danger"
                    />
                    <KpiCard
                      label="Unresolved Discrepancies"
                      value={metrics.kpis.unresolvedDiscrepancies}
                      tone={metrics.kpis.unresolvedDiscrepancies > 0 ? 'danger' : 'default'}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KpiCard label="Expiring Soon Batches" value={metrics.kpis.expiringBatchesCount} />
                    <KpiCard label="Pending Deliveries" value={metrics.kpis.pendingDeliveries} />
                    <KpiCard
                      label="Delivery Fulfilment"
                      value={`${metrics.kpis.deliveryFulfilmentPct}%`}
                      tone="green"
                    />
                    <KpiCard
                      label="Distribution Efficiency"
                      value={`${metrics.kpis.distributionEfficiencyPct}%`}
                    />
                  </div>

                  {/* Block Comparison Chart */}
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="k-card p-5">
                      <h2 className="mb-1 text-base font-bold">Block stock coverage</h2><p className="mb-3 text-sm text-[var(--text-secondary)]">Centre counts, grouped by stock availability.</p>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={metrics.blocks}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E0DAD0" />
                            <XAxis dataKey="blockName" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="centresCount" name="Total centres" fill="#1B4332" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="stockoutCentres" name="Centres with stockouts" fill="#D97706" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="k-card p-5">
                      <h2 className="mb-3 text-base font-bold">Daily Nutrition Distribution Trend</h2>
                      {distAnalytics && distAnalytics.dailyTrend.length > 0 ? (
                        <div className="h-72">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={distAnalytics.dailyTrend}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E0DAD0" />
                              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 12 }} />
                              <Tooltip />
                              <Line
                                type="monotone"
                                dataKey="totalQuantity"
                                name="Units Distributed"
                                stroke="#1B4332"
                                strokeWidth={2.5}
                                dot={{ r: 4 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <EmptyState
                          title="No distribution trend yet"
                          description="Daily distribution quantities appear here as centres record handovers."
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* CENTRES / BLOCK COMPARISON */}
              {tab === 'centres' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="absolute left-3 top-3.5 h-4 w-4 text-[var(--text-muted)]" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search centre name, code, or sector..."
                        className="k-input pl-9"
                      />
                    </div>
                    <select
                      value={blockFilter}
                      onChange={(e) => setBlockFilter(e.target.value)}
                      className="k-select w-48"
                    >
                      <option value="ALL">All Blocks</option>
                      {metrics.blocks.map((b) => (
                        <option key={b.blockId} value={b.blockId}>
                          {b.blockName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="k-card overflow-x-auto p-4">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                          <th className="py-2 pr-3">Code</th>
                          <th className="py-2 pr-3">Anganwadi Centre</th>
                          <th className="py-2 pr-3">Block / Sector</th>
                          <th className="py-2 pr-3">Usable Stock</th>
                          <th className="py-2 pr-3">Expiring Soon</th>
                          <th className="py-2 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCentres.map((c) => (
                          <tr key={c.centreId} className="border-b border-[var(--border)]">
                            <td className="font-mono-num py-3 pr-3 font-semibold">{c.code}</td>
                            <td className="py-3 pr-3 font-medium">
                              {lang === 'gu' ? c.centreNameGu || c.centreName : c.centreName}
                            </td>
                            <td className="py-3 pr-3 text-xs text-[var(--text-secondary)]">
                              {c.blockName} • {c.sectorName}
                            </td>
                            <td className="font-mono-num py-3 pr-3 font-bold">{c.usableStock}</td>
                            <td className="font-mono-num py-3 pr-3">{c.expiringSoonBatches}</td>
                            <td className="py-3 pr-3">
                              {c.hasStockout ? (
                                <StatusBadge variant="critical">Stockout Alert</StatusBadge>
                              ) : c.hasLowStock ? (
                                <StatusBadge variant="warning">Reorder Warning</StatusBadge>
                              ) : (
                                <StatusBadge variant="normal">Healthy</StatusBadge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* INVENTORY */}
              {tab === 'inventory' && (
                <div className="space-y-4">
                  {metrics.centres.map((c) => (
                    <div key={c.centreId} className="k-card p-5">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h2 className="font-bold">
                            {c.centreName} ({c.code})
                          </h2>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {c.blockName} • {c.sectorName}
                          </p>
                        </div>
                        <span className="font-mono-num text-sm font-bold text-[var(--accent)]">
                          Total Usable: {c.usableStock}
                        </span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        {c.products.map((p) => (
                          <div
                            key={p.productId}
                            className="rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)]/50 p-3 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold">{p.productName}</span>
                              <StatusBadge
                                variant={
                                  p.reorderLevel === 'STOCKOUT' || p.reorderLevel === 'CRITICAL'
                                    ? 'critical'
                                    : p.reorderLevel === 'WARNING'
                                      ? 'warning'
                                      : 'normal'
                                }
                              >
                                {p.reorderLevel}
                              </StatusBadge>
                            </div>
                            <p className="font-mono-num mt-1 text-base font-bold">
                              {p.usableStock} {p.unit}
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              {p.daysOfStock ?? 0} days • {p.averageDailyConsumption}/day{' '}
                              {p.isConsumptionEstimated && '(Est.)'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* STOCK REQUESTS */}
              {tab === 'stockRequests' && (
                <div className="k-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold">
                        Anganwadi Stock Replenishment Requests ({stockRequests.length})
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Approving a request authorizes Supplier dispatch — inventory only increases when AWW confirms physical receipt.
                      </p>
                    </div>
                    <StatusBadge
                      variant={
                        stockRequests.some((r) => r.status === 'PENDING_APPROVAL' || r.status === 'SUBMITTED')
                          ? 'warning'
                          : 'normal'
                      }
                    >
                      {stockRequests.filter((r) => r.status === 'PENDING_APPROVAL' || r.status === 'SUBMITTED').length} Pending
                    </StatusBadge>
                  </div>
                  {stockRequests.length === 0 ? (
                    <EmptyState
                      title="No stock requests"
                      description="Stock replenishment requests submitted by Anganwadi Workers appear here."
                    />
                  ) : (
                    <div className="space-y-3">
                      {stockRequests.map((sr) => {
                        const isPending = sr.status === 'PENDING_APPROVAL' || sr.status === 'SUBMITTED';
                        return (
                          <div
                            key={sr.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4 text-sm"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-num font-bold">{sr.requestNumber}</span>
                                <StatusBadge
                                  variant={
                                    sr.status === 'COMPLETED' || sr.status === 'APPROVED' || sr.status === 'PARTIALLY_APPROVED'
                                      ? 'normal'
                                      : sr.status === 'REJECTED'
                                        ? 'critical'
                                        : 'warning'
                                  }
                                >
                                  {sr.status}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                {sr.centre?.name} ({sr.centre?.code}) • {sr.product?.name} • Requested:{' '}
                                <span className="font-mono-num font-bold">
                                  {sr.requestedQuantity} {sr.product?.unit}
                                </span>
                                {sr.approvedQuantity != null && (
                                  <>
                                    {' '}
                                    | Approved:{' '}
                                    <span className="font-mono-num font-bold text-[var(--accent)]">
                                      {sr.approvedQuantity} {sr.product?.unit}
                                    </span>
                                  </>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                                Reason: {sr.reason} {sr.remarks ? `— ${sr.remarks}` : ''}
                              </p>
                              {sr.reviewRemarks && (
                                <p className="mt-0.5 text-xs italic text-[var(--accent)]">
                                  Review: {sr.reviewRemarks}
                                </p>
                              )}
                            </div>
                            {isPending && role === 'CDPO' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewReqTarget(sr);
                                  setReqDecision('APPROVE');
                                  setReqApprovedQty(String(sr.requestedQuantity));
                                  setReqReviewRemarks('Approved for supplier dispatch');
                                }}
                                className="k-btn-primary min-h-[38px] px-3 py-1.5 text-xs"
                              >
                                Review Request
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* DISCREPANCIES */}
              {tab === 'discrepancies' && (
                <div className="space-y-4">
                  <div className="k-card p-5">
                    <h2 className="mb-4 text-base font-bold">
                      Delivery Discrepancy Queue ({discrepancies.length})
                    </h2>
                    {discrepancies.length === 0 ? (
                      <EmptyState
                        title="No discrepancy cases"
                        description="All supplier dispatches matched AWW physical receipt counts."
                      />
                    ) : (
                      <div className="space-y-3">
                        {discrepancies.map((c) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4 text-sm"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-num font-bold">
                                  {c.dispatch?.dispatchReference}
                                </span>
                                <StatusBadge
                                  variant={
                                    c.status === 'RESOLVED' || c.status === 'APPROVED'
                                      ? 'normal'
                                      : 'critical'
                                  }
                                >
                                  {c.status}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                {c.dispatch?.destinationCentre?.name} • Supplier: {c.dispatch?.supplier?.name}
                              </p>
                              <p className="font-mono-num mt-1 text-xs">
                                Expected: {c.expectedQuantity} | Accepted: {c.actualQuantity} | Damaged:{' '}
                                {c.damagedQuantity} | Missing: {c.missingQuantity} (Diff: {c.difference})
                              </p>
                              {c.resolutionRemarks && (
                                <p className="mt-1 text-xs italic text-[var(--accent)]">
                                  Remarks: {c.resolutionRemarks}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {(role === 'SUPERVISOR' || role === 'CDPO') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCreateAppealDisc(c);
                                    setAppealRemarksInput('');
                                    setAppealFile(null);
                                  }}
                                  className="k-btn-saffron min-h-[38px] px-3 py-1.5 text-xs"
                                >
                                  <Send className="h-3.5 w-3.5" /> Raise Appeal
                                </button>
                              )}
                              {(canManage) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewCase(c);
                                    setReviewAction('RESOLVE');
                                    setReviewRemarks(c.resolutionRemarks || '');
                                  }}
                                  className="k-btn-primary min-h-[38px] px-3 py-1.5 text-xs"
                                >
                                  Review / Resolve
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Supervisor <-> Supplier Dispatch Appeals */}
                  <div className="k-card p-5">
                    <h2 className="mb-4 text-base font-bold">
                      Supplier Dispatch Appeals ({appeals.length})
                    </h2>
                    {appeals.length === 0 ? (
                      <EmptyState
                        title="No dispatch appeals yet"
                        description="Raise a formal appeal from any delivery discrepancy above to request supplier clarification."
                      />
                    ) : (
                      <div className="space-y-3">
                        {appeals.map((a) => (
                          <div
                            key={a.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4 text-sm"
                          >
                            <div className="max-w-2xl">
                              <div className="flex items-center gap-2">
                                <span className="font-mono-num font-bold">{a.appealReference}</span>
                                <StatusBadge
                                  variant={
                                    a.status === 'RESOLVED'
                                      ? 'normal'
                                      : a.status === 'ESCALATED' || a.status === 'REJECTED'
                                        ? 'critical'
                                        : 'warning'
                                  }
                                >
                                  {a.status}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                {a.centre?.name} • {a.dispatch?.dispatchReference} • Supplier: {a.supplier?.name}
                              </p>
                              <p className="mt-1 text-xs">
                                <span className="font-semibold">Supervisor:</span> {a.supervisorRemarks}
                              </p>
                              {a.supplierRemarks && (
                                <p className="mt-1 text-xs text-[var(--accent)]">
                                  <span className="font-semibold">Supplier Reply:</span> {a.supplierRemarks}
                                </p>
                              )}
                              {a.supplierEvidenceUrl && (
                                <a
                                  href={apiUrl(a.supplierEvidenceUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-xs font-semibold text-[var(--accent)] underline"
                                >
                                  View Supplier Evidence
                                </a>
                              )}
                              {a.resolutionRemarks && (
                                <p className="mt-1 text-xs italic text-[var(--text-secondary)]">
                                  Decision: {a.resolutionRemarks}
                                </p>
                              )}
                            </div>
                            {(canManage) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewAppealTarget(a);
                                  setAppealDecision('RESOLVED');
                                  setAppealDecisionRemarks('');
                                }}
                                className="k-btn-primary min-h-[38px] px-3 py-1.5 text-xs"
                              >
                                Update Appeal Status
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* RECONCILIATION & APPROVALS */}
              {tab === 'reconciliation' && (
                <div className="space-y-6">
                  <div className="k-card p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-base font-bold">Physical Stock Reconciliations</h2>
                      <button type="button" onClick={() => setReconOpen(true)} className="k-btn-primary min-h-[38px] text-xs">
                        Record Physical Count
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {reconciliations.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"
                        >
                          <div>
                            <p className="font-bold">
                              {r.centre?.name} • {r.product?.name} (Batch {r.batch?.batchNumber})
                            </p>
                            <p className="font-mono-num text-xs text-[var(--text-secondary)]">
                              Ledger: {r.calculatedStock} | Physical: {r.physicalStock} | Variance:{' '}
                              {r.variance}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge
                              variant={
                                r.status === 'APPROVED'
                                  ? 'normal'
                                  : r.status === 'REJECTED'
                                    ? 'critical'
                                    : 'warning'
                              }
                            >
                              {r.status}
                            </StatusBadge>
                            {canManage && r.status === 'PENDING_APPROVAL' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setApprovalTarget({
                                      id: r.id,
                                      entityType: 'RECONCILIATION',
                                      decision: 'approve',
                                      label: `Approve reconciliation variance (${r.variance})`,
                                    })
                                  }
                                  className="k-btn-primary min-h-[34px] px-3 py-1 text-xs"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setApprovalTarget({
                                      id: r.id,
                                      entityType: 'RECONCILIATION',
                                      decision: 'reject',
                                      label: 'Reject reconciliation',
                                    })
                                  }
                                  className="k-btn-secondary min-h-[34px] px-3 py-1 text-xs"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="k-card p-5">
                    <h2 className="mb-3 text-base font-bold">Spoilage Reports Queue</h2>
                    {spoilages.length === 0 ? (
                      <EmptyState title="No spoilage reports" description="No damaged or spoiled stock reports submitted." />
                    ) : (
                      <div className="space-y-2.5">
                        {spoilages.map((s) => (
                          <div
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"
                          >
                            <div>
                              <p className="font-bold">
                                {s.centre?.name} • {s.product?.name} ({s.quantity} {s.product?.unit})
                              </p>
                              <p className="text-xs text-[var(--text-secondary)]">
                                Batch {s.batch?.batchNumber} • Reason: {s.reason}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge
                                variant={
                                  s.status === 'APPROVED'
                                    ? 'normal'
                                    : s.status === 'REJECTED'
                                      ? 'critical'
                                      : 'warning'
                                }
                              >
                                {s.status}
                              </StatusBadge>
                              {canManage && s.status === 'PENDING' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setApprovalTarget({
                                        id: s.id,
                                        entityType: 'SPOILAGE',
                                        decision: 'approve',
                                        label: `Approve spoilage deduction (${s.quantity} ${s.product?.unit})`,
                                      })
                                    }
                                    className="k-btn-primary min-h-[34px] px-3 py-1 text-xs"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setApprovalTarget({
                                        id: s.id,
                                        entityType: 'SPOILAGE',
                                        decision: 'reject',
                                        label: 'Reject spoilage report',
                                      })
                                    }
                                    className="k-btn-secondary min-h-[34px] px-3 py-1 text-xs"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* BENEFICIARY APPROVALS (MUKHYA SEVIKA / CDPO) */}
              {tab === 'beneficiaries' && (
                <div className="k-card p-5">
                  {role === 'SUPERVISOR' && <BeneficiaryAccounts />}
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold">
                        Beneficiary Reference Approvals ({beneficiaries.length})
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Review beneficiaries added by Anganwadi Workers before allowing ration handover.
                      </p>
                    </div>
                    <StatusBadge
                      variant={
                        beneficiaries.some((b) => b.status === 'PENDING_APPROVAL')
                          ? 'warning'
                          : 'normal'
                      }
                    >
                      {beneficiaries.filter((b) => b.status === 'PENDING_APPROVAL').length} Pending
                    </StatusBadge>
                  </div>

                  {beneficiaries.length === 0 ? (
                    <EmptyState
                      title="No beneficiary references in scope"
                      description="Beneficiary requests submitted by AWWs in your sector appear here."
                    />
                  ) : (
                    <div className="space-y-3">
                      {beneficiaries.map((b) => (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4 text-sm"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold">
                                {lang === 'gu' ? b.displayNameGu || b.displayName : b.displayName}
                              </span>
                              <StatusBadge
                                variant={
                                  b.status === 'APPROVED'
                                    ? 'normal'
                                    : b.status === 'REJECTED'
                                      ? 'critical'
                                      : 'warning'
                                }
                              >
                                {b.status || 'APPROVED'}
                              </StatusBadge>
                            </div>
                            <p className="font-mono-num mt-1 text-xs text-[var(--text-secondary)]">
                              {b.centre?.name} ({b.centre?.code}) • {b.localReference} • YOB{' '}
                              {b.yob || '—'} • {b.beneficiaryCategory}
                            </p>
                            {b.requester && (
                              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                                Requested by: {b.requester.name} ({b.requester.role})
                              </p>
                            )}
                            {b.reviewRemarks && (
                              <p className="mt-0.5 text-xs italic text-[var(--accent)]">
                                Sevika Remarks: {b.reviewRemarks}
                              </p>
                            )}
                          </div>

                          {canManage && b.status === 'PENDING_APPROVAL' && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setBenReviewTarget({ beneficiary: b, action: 'APPROVE' });
                                  setBenReviewRemarks('Verified against AWC register and POSHAN reference');
                                }}
                                className="k-btn-primary min-h-[36px] px-3 py-1.5 text-xs"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBenReviewTarget({ beneficiary: b, action: 'REJECT' });
                                  setBenReviewRemarks('');
                                }}
                                className="k-btn-secondary min-h-[36px] px-3 py-1.5 text-xs text-[var(--danger)]"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MONTHLY ENTITLEMENT RULES */}
              {tab === 'entitlements' && (
                <div className="k-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold">
                        Beneficiary Monthly Nutrition Entitlement Rules ({entitlementRules.length})
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Automatic product selection & monthly packet ceilings reset every calendar month. Pending categories (such as Kishori Purnashakti) remain blocked until confirmed here.
                      </p>
                    </div>
                  </div>

                  {entitlementRules.length === 0 ? (
                    <EmptyState
                      title="No entitlement rules loaded"
                      description="Refresh dashboard to load configured ICDS nutrition entitlement rules."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                            <th className="py-2 pr-3">Beneficiary Category</th>
                            <th className="py-2 pr-3">Product</th>
                            <th className="py-2 pr-3">Monthly Limit</th>
                            <th className="py-2 pr-3">Packet Weight</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entitlementRules.map((rule) => {
                            const catMeta = BENEFICIARY_CATEGORY_OPTIONS.find(
                              (opt) => opt.value === rule.beneficiaryCategory
                            );
                            return (
                              <tr key={rule.id} className="border-b border-[var(--border)]">
                                <td className="py-3 pr-3">
                                  <p className="font-semibold">
                                    {catMeta?.label || rule.beneficiaryCategory}
                                  </p>
                                  {rule.notes && (
                                    <p className="text-[11px] text-[var(--text-muted)]">{rule.notes}</p>
                                  )}
                                </td>
                                <td className="py-3 pr-3">
                                  {rule.product ? (
                                    <span className="font-medium">
                                      {lang === 'gu' ? rule.product.nameGu : rule.product.name}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-[var(--text-muted)]">Not Assigned</span>
                                  )}
                                </td>
                                <td className="font-mono-num py-3 pr-3 font-bold">
                                  {rule.isConfigured && rule.monthlyLimit !== null
                                    ? `${rule.monthlyLimit} ${rule.product?.unit || 'packets'}`
                                    : 'Pending'}
                                </td>
                                <td className="font-mono-num py-3 pr-3 text-xs">
                                  {rule.packetWeightLabel || 'Configurable'}
                                </td>
                                <td className="py-3 pr-3">
                                  {!rule.isActive ? (
                                    <StatusBadge variant="neutral">Inactive / HCM</StatusBadge>
                                  ) : rule.isConfigured ? (
                                    <StatusBadge variant="normal">Configured</StatusBadge>
                                  ) : (
                                    <StatusBadge variant="warning">Pending Confirmation</StatusBadge>
                                  )}
                                </td>
                                <td className="py-3 pr-3">
                                  <button
                                    type="button"
                                    disabled={!canManage}
                                    onClick={() => {
                                      setEditRuleTarget(rule);
                                      setRuleProductId(rule.productId || '');
                                      setRuleMonthlyLimit(
                                        rule.monthlyLimit !== null ? String(rule.monthlyLimit) : ''
                                      );
                                      setRuleWeightGrams(
                                        rule.packetWeightGrams !== null
                                          ? String(rule.packetWeightGrams)
                                          : ''
                                      );
                                      setRuleWeightLabel(rule.packetWeightLabel || '');
                                      setRuleIsConfigured(rule.isConfigured);
                                      setRuleIsActive(rule.isActive);
                                      setRuleNotes(rule.notes || '');
                                      setRuleAuditReason('');
                                    }}
                                    className="k-btn-secondary min-h-[34px] px-3 py-1 text-xs"
                                  >
                                    {!canManage ? 'View only' : rule.isConfigured ? 'Update Rule' : 'Confirm Policy'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* EXPIRY MONITORING */}
              {tab === 'expiry' && (
                <div className="k-card overflow-x-auto p-5">
                  <h2 className="mb-3 text-base font-bold">FEFO Batch & Expiry Monitoring</h2>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                        <th className="py-2 pr-3">Centre</th>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3">Batch</th>
                        <th className="py-2 pr-3">Balance</th>
                        <th className="py-2 pr-3">Expiry Date</th>
                        <th className="py-2 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allBatches
                        .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
                        .map((b, i) => (
                          <tr key={`${b.batchId}-${b.centreCode}-${i}`} className="border-b border-[var(--border)]">
                            <td className="py-2.5 pr-3 text-xs font-medium">{b.centreName}</td>
                            <td className="py-2.5 pr-3">{b.productName}</td>
                            <td className="font-mono-num py-2.5 pr-3 text-xs">{b.batchNumber}</td>
                            <td className="font-mono-num py-2.5 pr-3 font-bold">
                              {b.balance} {b.unit}
                            </td>
                            <td className="font-mono-num py-2.5 pr-3 text-xs">
                              {new Date(b.expiryDate).toLocaleDateString()} ({b.daysToExpiry}d)
                            </td>
                            <td className="py-2.5 pr-3">
                              {b.isExpired ? (
                                <StatusBadge variant="critical">Expired (Blocked)</StatusBadge>
                              ) : b.isExpiringSoon ? (
                                <StatusBadge variant="warning">Expiring Soon</StatusBadge>
                              ) : (
                                <StatusBadge variant="normal">Usable</StatusBadge>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ALERTS / STOCKOUTS */}
              {tab === 'alerts' && (
                <div className="k-card p-5">
                  <h2 className="mb-3 text-base font-bold">Active Reorder & Stockout Alerts ({alerts.length})</h2>
                  {alerts.length === 0 ? (
                    <EmptyState title="No active alerts" description="All monitored centres are above alert thresholds." />
                  ) : (
                    <div className="space-y-2.5">
                      {alerts.map((a) => (
                        <div
                          key={a.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"
                        >
                          <div>
                            <p className="font-bold">
                              {a.centre?.name} ({a.centre?.code})
                            </p>
                            <p className="text-xs text-[var(--text-secondary)]">
                              {lang === 'gu' ? a.messageGu : a.message}
                            </p>
                          </div>
                          <StatusBadge
                            variant={
                              a.severity === 'CRITICAL'
                                ? 'critical'
                                : a.severity === 'WARNING'
                                  ? 'warning'
                                  : 'info'
                            }
                          >
                            {a.alertType}
                          </StatusBadge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SUPPLIERS */}
              {tab === 'suppliers' && (
                <div className="k-card p-5">
                  <h2 className="mb-3 text-base font-bold">Supplier Performance & Fulfilment</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                          <th className="py-2 pr-3">Supplier</th>
                          <th className="py-2 pr-3">Dispatches</th>
                          <th className="py-2 pr-3">Delivered</th>
                          <th className="py-2 pr-3">Discrepancies</th>
                          <th className="py-2 pr-3">Fulfilment Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPerf.map((s) => (
                          <tr key={s.supplierId} className="border-b border-[var(--border)]">
                            <td className="py-3 pr-3 font-semibold">{s.supplierName}</td>
                            <td className="font-mono-num py-3 pr-3">{s.totalDispatches}</td>
                            <td className="font-mono-num py-3 pr-3">{s.deliveredCount}</td>
                            <td className="font-mono-num py-3 pr-3 text-[var(--danger)]">
                              {s.discrepancyCount}
                            </td>
                            <td className="font-mono-num py-3 pr-3 font-bold text-[var(--accent)]">
                              {s.fulfilmentRatePct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* DELIVERIES */}
              {tab === 'deliveries' && (
                <div className="k-card p-5">
                  <h2 className="mb-3 text-base font-bold">Scheduled & Completed Deliveries</h2>
                  <div className="space-y-2.5">
                    {dispatches.map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"
                      >
                        <div>
                          <p className="font-mono-num font-bold">
                            {d.dispatchReference} → {d.destinationCentre.name}
                          </p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            Supplier: {d.supplier.name} • Dispatched:{' '}
                            {new Date(d.dispatchDate).toLocaleDateString()}
                            {d.vehicleNumber ? ` • Vehicle: ${d.vehicleNumber}` : ''}
                          </p>
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
                    ))}
                  </div>
                </div>
              )}

              {/* MALNUTRITION TRENDS (DDO) */}
              {tab === 'malnutrition' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-300 bg-[var(--saffron-subtle)] px-4 py-3 text-xs font-semibold text-[var(--warning)]">
                    {metrics.nutritionDataNotice ||
                      'Synthetic demonstration aggregate data — complements POSHAN Tracker without duplicating child growth monitoring.'}
                  </div>
                  <div className="k-card p-5">
                    <h2 className="mb-3 text-base font-bold">
                      Panchmahal Aggregated Malnutrition Prevalence Trends (%)
                    </h2>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={malnutritionByPeriod}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E0DAD0" />
                          <XAxis dataKey="period" />
                          <YAxis unit="%" />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="underweightPct" name="Underweight %" stroke="#1B4332" strokeWidth={2.5} />
                          <Line type="monotone" dataKey="wastingPct" name="Wasting %" stroke="#D97706" strokeWidth={2.5} />
                          <Line type="monotone" dataKey="samPct" name="Severe Acute Malnutrition (SAM) %" stroke="#B91C1C" strokeWidth={2.5} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* REPORTS */}
              {tab === 'reports' && (
                <div className="k-card space-y-4 p-6">
                  <h2 className="text-base font-bold">Supply Chain Accountability Reports</h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Download verified centre-level usable stock, stockout alerts, and expiring batch
                    reports for administrative review.
                  </p>
                  <button type="button" onClick={exportCsvReport} className="k-btn-primary">
                    <Download className="h-4 w-4" />
                    Download Inventory & Stockout CSV
                  </button>
                  <MonthlyReport />
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Supervisor Discrepancy Review Modal */}
      <ModalDialog
        open={Boolean(reviewCase)}
        onClose={() => setReviewCase(null)}
        title="Review Delivery Discrepancy"
        subtitle={reviewCase?.dispatch?.dispatchReference}
      >
        {reviewCase && (
          <form onSubmit={submitDiscrepancyReview} className="space-y-4">
            <div className="rounded-xl bg-[var(--bg-sunken)] p-3 text-xs space-y-1">
              <p>
                <strong>Expected:</strong> {reviewCase.expectedQuantity} |{' '}
                <strong>Accepted:</strong> {reviewCase.actualQuantity}
              </p>
              <p>
                <strong>Damaged:</strong> {reviewCase.damagedQuantity} |{' '}
                <strong>Missing:</strong> {reviewCase.missingQuantity}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Administrative Decision</label>
              <select
                value={reviewAction}
                onChange={(e) => setReviewAction(e.target.value as typeof reviewAction)}
                className="k-select"
              >
                <option value="APPROVE">Approve Discrepancy Report</option>
                <option value="REQUEST_RECOUNT">Request Physical Recount</option>
                <option value="REJECT">Reject Claim</option>
                <option value="RESOLVE">Mark Resolved</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">
                Mandatory Resolution Remarks
              </label>
              <textarea
                rows={3}
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Enter official supervisor verification remarks..."
                className="k-textarea"
                required
                minLength={3}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setReviewCase(null)} className="k-btn-secondary flex-1">
                {t('cancel')}
              </button>
              <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
                {submitting ? t('loading') : 'Save Decision'}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* Physical Stock Reconciliation Modal */}
      <ModalDialog
        open={reconOpen}
        onClose={() => setReconOpen(false)}
        title="Physical Stock Verification"
        subtitle="Creates a compensating adjustment event without overwriting historical ledger entries"
      >
        <form onSubmit={submitReconciliation} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Anganwadi Centre</label>
            <select
              value={reconCentreId}
              onChange={(e) => {
                const cid = e.target.value;
                setReconCentreId(cid);
                const c = metrics?.centres.find((x) => x.centreId === cid);
                const p = c?.products.find((pr) => pr.batches.length > 0) || c?.products[0];
                setReconProductId(p?.productId || '');
                setReconBatchId(p?.batches[0]?.batchId || '');
              }}
              className="k-select"
            >
              {metrics?.centres.map((c) => (
                <option key={c.centreId} value={c.centreId}>
                  {c.centreName} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Product</label>
            <select
              value={reconProductId}
              onChange={(e) => {
                const pid = e.target.value;
                setReconProductId(pid);
                const p = reconCentre?.products.find((pr) => pr.productId === pid);
                setReconBatchId(p?.batches[0]?.batchId || '');
              }}
              className="k-select"
            >
              {reconCentre?.products
                .filter((p) => p.batches.length > 0)
                .map((p) => (
                  <option key={p.productId} value={p.productId}>
                    {p.productName}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Batch</label>
            <select
              value={reconBatchId}
              onChange={(e) => setReconBatchId(e.target.value)}
              className="k-select"
              required
            >
              {reconProduct?.batches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batchNumber} (Ledger Balance: {b.balance} {reconProduct.unit})
                </option>
              ))}
            </select>
          </div>

          {reconBatch && (
            <div className="rounded-xl bg-[var(--bg-sunken)] p-3 text-xs">
              Calculated Ledger Balance:{' '}
              <strong className="font-mono-num">
                {reconBatch.balance} {reconProduct?.unit}
              </strong>
              {reconPhysicalStock !== '' && (
                <span className="ml-3">
                  Variance:{' '}
                  <strong className="font-mono-num">
                    {(Number(reconPhysicalStock) - reconBatch.balance).toFixed(2)}
                  </strong>
                </span>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold">Actual Physical Count</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={reconPhysicalStock}
              onChange={(e) => setReconPhysicalStock(e.target.value)}
              className="k-input"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Verification Remarks</label>
            <textarea
              rows={2}
              value={reconRemarks}
              onChange={(e) => setReconRemarks(e.target.value)}
              placeholder="Physical shelf verification remarks..."
              className="k-textarea"
              required
              minLength={3}
            />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setReconOpen(false)} className="k-btn-secondary flex-1">
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Record & Approve Adjustment'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Spoilage / Reconciliation Approval Remarks Modal */}
      <ModalDialog
        open={Boolean(approvalTarget)}
        onClose={() => setApprovalTarget(null)}
        title={approvalTarget?.label || 'Review Decision'}
      >
        <form onSubmit={submitApprovalDecision} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Official Remarks</label>
            <textarea
              rows={3}
              value={approvalRemarks}
              onChange={(e) => setApprovalRemarks(e.target.value)}
              className="k-textarea"
              required
              minLength={3}
              placeholder="Enter justification or verification notes..."
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setApprovalTarget(null)} className="k-btn-secondary flex-1">
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Confirm Decision'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Beneficiary Approval Remarks Modal */}
      <ModalDialog
        open={Boolean(benReviewTarget)}
        onClose={() => setBenReviewTarget(null)}
        title={
          benReviewTarget?.action === 'APPROVE'
            ? 'Approve Beneficiary Reference'
            : 'Reject Beneficiary Reference'
        }
        subtitle={benReviewTarget?.beneficiary.displayName}
      >
        <form onSubmit={submitBeneficiaryReview} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">
              Mukhya Sevika Verification Remarks
            </label>
            <textarea
              rows={3}
              value={benReviewRemarks}
              onChange={(e) => setBenReviewRemarks(e.target.value)}
              className="k-textarea"
              required
              minLength={3}
              placeholder="Enter verification notes..."
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setBenReviewTarget(null)} className="k-btn-secondary flex-1">
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Confirm'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Raise Appeal to Supplier Modal */}
      <ModalDialog
        open={Boolean(createAppealDisc)}
        onClose={() => setCreateAppealDisc(null)}
        title="Raise Appeal to Supplier"
        subtitle={createAppealDisc?.dispatch?.dispatchReference}
      >
        <form onSubmit={submitCreateAppeal} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Supervisor Appeal Statement</label>
            <textarea
              rows={3}
              value={appealRemarksInput}
              onChange={(e) => setAppealRemarksInput(e.target.value)}
              className="k-textarea"
              required
              minLength={5}
              placeholder="Detail shortage/damage claim for formal Supplier response..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Attachment Evidence (Optional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setAppealFile(e.target.files?.[0] || null)}
              className="k-input py-2 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCreateAppealDisc(null)}
              className="k-btn-secondary flex-1"
            >
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-saffron flex-1">
              {submitting ? t('loading') : 'Submit Appeal'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Review Supplier Appeal Modal */}
      <ModalDialog
        open={Boolean(reviewAppealTarget)}
        onClose={() => setReviewAppealTarget(null)}
        title="Update Dispatch Appeal Status"
        subtitle={reviewAppealTarget?.appealReference}
      >
        <form onSubmit={submitAppealReview} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Decision</label>
            <select
              value={appealDecision}
              onChange={(e) =>
                setAppealDecision(
                  e.target.value as 'RESOLVED' | 'REJECTED' | 'ESCALATED' | 'UNDER_REVIEW'
                )
              }
              className="k-select"
            >
              <option value="UNDER_REVIEW">Mark Under Review</option>
              <option value="RESOLVED">Resolve Appeal</option>
              <option value="ESCALATED">Escalate to District Authority</option>
              <option value="REJECTED">Close / Reject Claim</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Resolution / Escalation Remarks</label>
            <textarea
              rows={3}
              value={appealDecisionRemarks}
              onChange={(e) => setAppealDecisionRemarks(e.target.value)}
              className="k-textarea"
              required
              minLength={3}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReviewAppealTarget(null)}
              className="k-btn-secondary flex-1"
            >
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Save Decision'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Review Stock Request Modal */}
      <ModalDialog
        open={Boolean(reviewReqTarget)}
        onClose={() => setReviewReqTarget(null)}
        title="Review Stock Request"
        subtitle={
          reviewReqTarget
            ? `${reviewReqTarget.requestNumber} • ${reviewReqTarget.product?.name} (${reviewReqTarget.requestedQuantity} ${reviewReqTarget.product?.unit})`
            : undefined
        }
      >
        <form onSubmit={submitStockRequestReview} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold">Decision</label>
            <select
              value={reqDecision}
              onChange={(e) =>
                setReqDecision(e.target.value as 'APPROVE' | 'PARTIAL_APPROVE' | 'REJECT')
              }
              className="k-select"
            >
              <option value="APPROVE">Approve Full Requested Quantity</option>
              <option value="PARTIAL_APPROVE">Partially Approve Custom Quantity</option>
              <option value="REJECT">Reject Request</option>
            </select>
          </div>
          {reqDecision !== 'REJECT' && (
            <div>
              <label className="mb-1 block text-xs font-semibold">
                Approved Quantity ({reviewReqTarget?.product?.unit})
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max={reviewReqTarget?.requestedQuantity}
                value={reqApprovedQty}
                onChange={(e) => setReqApprovedQty(e.target.value)}
                className="k-input"
                required={reqDecision === 'PARTIAL_APPROVE'}
              />
            </div>
          )}
          {reqDecision !== 'REJECT' && <label className="block text-sm font-semibold">Assigned supplier<select required className="k-select mt-1" value={reqSupplierId} onChange={e => setReqSupplierId(e.target.value)}><option value="">Choose block supplier</option>{supplierProfiles.filter(s => s.isActive).map(s => <option key={s.id} value={s.supplierId}>{s.supplier.name}</option>)}</select></label>}
          <div>
            <label className="mb-1 block text-xs font-semibold">CDPO Remarks</label>
            <textarea
              rows={3}
              value={reqReviewRemarks}
              onChange={(e) => setReqReviewRemarks(e.target.value)}
              className="k-textarea"
              required
              minLength={3}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReviewReqTarget(null)}
              className="k-btn-secondary flex-1"
            >
              {t('cancel')}
            </button>
            <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
              {submitting ? t('loading') : 'Confirm Decision'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Edit / Confirm Entitlement Rule Modal */}
      <ModalDialog
        open={Boolean(editRuleTarget)}
        onClose={() => setEditRuleTarget(null)}
        title="Configure Beneficiary Entitlement Rule"
        subtitle={
          editRuleTarget
            ? BENEFICIARY_CATEGORY_OPTIONS.find(
                (o) => o.value === editRuleTarget.beneficiaryCategory
              )?.label || editRuleTarget.beneficiaryCategory
            : undefined
        }
      >
        {editRuleTarget && (
          <form onSubmit={submitEntitlementRuleUpdate} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={ruleIsActive}
                  onChange={(e) => setRuleIsActive(e.target.checked)}
                />
                Rule Active for Ration Allocation
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={ruleIsConfigured}
                  onChange={(e) => setRuleIsConfigured(e.target.checked)}
                />
                Officially Confirmed & Enabled
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">Assigned Product</label>
              <select
                value={ruleProductId}
                onChange={(e) => setRuleProductId(e.target.value)}
                className="k-select"
              >
                <option value="">No Product Assigned</option>
                {Array.from(
                  new Map(
                    [
                      ...(metrics?.centres.flatMap((c) =>
                        c.products.map((p) => ({
                          id: p.productId,
                          name: p.productName,
                          unit: p.unit,
                        }))
                      ) ?? []),
                      ...entitlementRules
                        .filter((r) => r.product)
                        .map((r) => ({
                          id: r.product!.id,
                          name: r.product!.name,
                          unit: r.product!.unit,
                        })),
                    ].map((p) => [p.id, p])
                  ).values()
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unit})
                  </option>
                ))}
              </select>
            </div>

            {ruleIsConfigured && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Monthly Limit (packets)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={ruleMonthlyLimit}
                    onChange={(e) => setRuleMonthlyLimit(e.target.value)}
                    className="k-input"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Packet Weight (g)</label>
                  <input
                    type="number"
                    min="50"
                    step="50"
                    value={ruleWeightGrams}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRuleWeightGrams(val);
                      const num = Number(val);
                      if (Number.isFinite(num) && num > 0) {
                        setRuleWeightLabel(num >= 1000 ? `${num / 1000} kg` : `${num} g`);
                      }
                    }}
                    className="k-input"
                    placeholder="500 or 1000"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Weight Label</label>
                  <input
                    type="text"
                    value={ruleWeightLabel}
                    onChange={(e) => setRuleWeightLabel(e.target.value)}
                    className="k-input"
                    placeholder="500 g or 1 kg"
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold">Policy Notes</label>
              <input
                type="text"
                value={ruleNotes}
                onChange={(e) => setRuleNotes(e.target.value)}
                className="k-input"
                placeholder="Official ICDS circular / ration entitlement note"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold">
                Official Justification (Audit Log Required)
              </label>
              <textarea
                rows={3}
                value={ruleAuditReason}
                onChange={(e) => setRuleAuditReason(e.target.value)}
                className="k-textarea"
                required
                minLength={5}
                placeholder="Enter Government Resolution / ICDS order reference authorizing change..."
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditRuleTarget(null)}
                className="k-btn-secondary flex-1"
              >
                {t('cancel')}
              </button>
              <button type="submit" disabled={submitting} className="k-btn-primary flex-1">
                {submitting ? t('loading') : 'Save Entitlement Rule'}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
}

