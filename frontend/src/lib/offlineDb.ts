import Dexie, { Table } from 'dexie';
import {
  AlertItem,
  BeneficiaryEntitlementSummary,
  BeneficiaryReference,
  DispatchRecord,
  DistributionRecord,
  EligibilityStatus,
  EntitlementRule,
  MonthlyDistributionLite,
  OutboxStatus,
  Product,
  ProductInventorySummary,
  StockRequest,
} from '../types';
import { apiRequest, apiUrl } from './api';

export type OfflineOperationType =
  | 'CREATE_BENEFICIARY'
  | 'DISTRIBUTION'
  | 'CONSUMPTION'
  | 'SPOILAGE'
  | 'RECEIVE_DISPATCH'
  | 'CREATE_STOCK_REQUEST';

export interface OutboxRecord {
  operationUuid: string;
  operationType: OfflineOperationType;
  centreId: string;
  userId: string;
  summaryLabel: string;
  summaryLabelGu: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
  syncedAt?: string;
}

export interface CachedCentreSnapshot {
  centreId: string;
  syncedAt: string;
  currentMonth?: string;
  offlineCredentialSalt?: string | null;
  products: Product[];
  inventorySummary: ProductInventorySummary[];
  pendingDispatches: DispatchRecord[];
  beneficiaries: BeneficiaryReference[];
  recentDistributions: DistributionRecord[];
  monthlyDistributions?: MonthlyDistributionLite[];
  entitlementRules?: EntitlementRule[];
  alerts: AlertItem[];
  stockRequests?: StockRequest[];
}

export function formatIstMonth(date: Date = new Date()): string {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 7);
}

function roundQty(val: number): number {
  return Math.round(val * 100) / 100;
}

export function computeOfflineEntitlementSummary(params: {
  beneficiary: BeneficiaryReference;
  entitlementRules: EntitlementRule[];
  monthlyDistributions: MonthlyDistributionLite[];
  inventorySummary: ProductInventorySummary[];
  outbox: OutboxRecord[];
  products?: Product[];
  distributionMonth?: string;
}): BeneficiaryEntitlementSummary {
  const distributionMonth = params.distributionMonth ?? formatIstMonth();
  const rule =
    params.entitlementRules.find(
      (r) => r.beneficiaryCategory === params.beneficiary.beneficiaryCategory
    ) ?? null;

  const invEntry = rule?.productId
    ? params.inventorySummary.find((p) => p.productId === rule.productId)
    : undefined;
  const catalogProduct = rule?.productId
    ? params.products?.find((p) => p.id === rule.productId) ?? null
    : null;
  const invProduct = invEntry
    ? {
        id: invEntry.productId,
        code: '',
        name: invEntry.productName,
        nameGu: invEntry.productNameGu,
        category: invEntry.category,
        unit: invEntry.unit,
      }
    : null;
  const prodMeta = rule?.product ?? catalogProduct ?? invProduct;

  let serverDistributed = 0;
  if (rule?.productId) {
    for (const d of params.monthlyDistributions) {
      if (
        d.beneficiaryReferenceId === params.beneficiary.id &&
        d.productId === rule.productId &&
        d.distributionMonth === distributionMonth
      ) {
        serverDistributed += Number(d.quantity) || 0;
      }
    }
  }

  // Also include unsynced local outbox DISTRIBUTION entries in the current IST month
  // and subtract queued outbox distribution quantities from locally usable stock.
  let pendingDistributedForBeneficiary = 0;
  let pendingStockDeductionForProduct = 0;
  if (rule?.productId) {
    for (const op of params.outbox) {
      if (
        op.operationType !== 'DISTRIBUTION' ||
        op.status === 'synced' ||
        op.status === 'conflict'
      ) {
        continue;
      }
      const payload = op.payload as {
        beneficiaryReferenceId?: string;
        productId?: string;
        quantity?: number;
        items?: Array<{ productId?: string; quantity?: number }>;
      };
      const items: Array<{ productId?: string; quantity?: number }> = Array.isArray(payload.items)
        ? payload.items
        : payload.productId
          ? [{ productId: payload.productId, quantity: payload.quantity }]
          : [];
      const opMonth = formatIstMonth(new Date(op.createdAt));

      for (const item of items) {
        const pid: string = item.productId || rule.productId;
        const qty = Number(item.quantity) || 0;
        if (qty <= 0 || pid !== rule.productId) continue;
        pendingStockDeductionForProduct += qty;
        if (
          payload.beneficiaryReferenceId === params.beneficiary.id &&
          opMonth === distributionMonth
        ) {
          pendingDistributedForBeneficiary += qty;
        }
      }
    }
  }

  const distributedQuantity = roundQty(serverDistributed + pendingDistributedForBeneficiary);
  const usableStock = Math.max(
    0,
    roundQty((invEntry?.usableStock ?? 0) - pendingStockDeductionForProduct)
  );
  const monthlyLimit =
    rule?.isConfigured && rule.monthlyLimit !== null ? roundQty(rule.monthlyLimit) : null;
  const remainingQuantity =
    monthlyLimit !== null ? Math.max(0, roundQty(monthlyLimit - distributedQuantity)) : null;

  let eligibilityStatus: EligibilityStatus;
  if (params.beneficiary.status && params.beneficiary.status !== 'APPROVED') {
    eligibilityStatus = 'VERIFICATION_REQUIRED';
  } else if (
    !rule ||
    !rule.isActive ||
    !rule.isConfigured ||
    !rule.productId ||
    monthlyLimit === null
  ) {
    eligibilityStatus = 'PENDING_CONFIGURATION';
  } else if (remainingQuantity !== null && remainingQuantity <= 0) {
    eligibilityStatus = 'LIMIT_EXHAUSTED';
  } else if (usableStock <= 0) {
    eligibilityStatus = 'INSUFFICIENT_STOCK';
  } else {
    eligibilityStatus = 'ELIGIBLE';
  }

  const maxAllocatable =
    eligibilityStatus === 'ELIGIBLE' && remainingQuantity !== null
      ? Math.max(0, Math.floor(Math.min(remainingQuantity, usableStock)))
      : 0;

  return {
    beneficiary: {
      id: params.beneficiary.id,
      centreId: params.beneficiary.centreId,
      localReference: params.beneficiary.localReference,
      displayName: params.beneficiary.displayName,
      displayNameGu: params.beneficiary.displayNameGu,
      yob: params.beneficiary.yob,
      beneficiaryCategory: params.beneficiary.beneficiaryCategory,
      status: params.beneficiary.status,
    },
    rule,
    product: prodMeta,
    distributionMonth,
    monthlyLimit,
    packetWeightGrams: rule?.packetWeightGrams ?? null,
    packetWeightLabel: rule?.packetWeightLabel ?? null,
    distributedQuantity,
    remainingQuantity,
    usableStock,
    maxAllocatable,
    eligibilityStatus,
    canDistribute: eligibilityStatus === 'ELIGIBLE',
  };
}

class KhorakOfflineDatabase extends Dexie {
  snapshots!: Table<CachedCentreSnapshot, string>;
  outbox!: Table<OutboxRecord, string>;

  constructor() {
    super('khorak_offline_v1');
    this.version(1).stores({
      snapshots: 'centreId, syncedAt',
      outbox: 'operationUuid, status, centreId, createdAt',
    });
  }
}

export const offlineDb = new KhorakOfflineDatabase();

export async function checkServerConnectivity(timeoutMs = 8000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl('/api/health'), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function pullCentreSnapshot(centreId: string, allowCached = true): Promise<CachedCentreSnapshot | null> {
  try {
    const res = await apiRequest<{
      success: boolean;
      data: Omit<CachedCentreSnapshot, 'centreId'> & {
        centre: { id: string; offlineCredentialSalt?: string | null };
      };
    }>(`/api/sync/pull?centreId=${encodeURIComponent(centreId)}`);
    const snapshot: CachedCentreSnapshot = {
      centreId,
      syncedAt: res.data.syncedAt,
      currentMonth: res.data.currentMonth,
      offlineCredentialSalt: res.data.centre?.offlineCredentialSalt ?? null,
      products: res.data.products,
      inventorySummary: res.data.inventorySummary,
      pendingDispatches: res.data.pendingDispatches,
      beneficiaries: res.data.beneficiaries,
      recentDistributions: res.data.recentDistributions,
      monthlyDistributions: res.data.monthlyDistributions ?? [],
      entitlementRules: res.data.entitlementRules ?? [],
      alerts: res.data.alerts,
      stockRequests: res.data.stockRequests ?? [],
    };
    await offlineDb.snapshots.put(snapshot);
    return snapshot;
  } catch (err) {
    if (!allowCached) throw err;
    const cached = await offlineDb.snapshots.get(centreId);
    return cached ?? null;
  }
}

export async function getCachedSnapshot(centreId: string): Promise<CachedCentreSnapshot | null> {
  return (await offlineDb.snapshots.get(centreId)) ?? null;
}

export async function enqueueOfflineOperation(
  op: Omit<OutboxRecord, 'status' | 'retryCount' | 'createdAt'>
): Promise<OutboxRecord> {
  const record: OutboxRecord = {
    ...op,
    status: 'saved_locally',
    retryCount: 0,
    createdAt: new Date().toISOString(),
  };
  await offlineDb.outbox.put(record);
  return record;
}

export async function listOutboxOperations(centreId?: string): Promise<OutboxRecord[]> {
  const all = centreId
    ? await offlineDb.outbox.where('centreId').equals(centreId).toArray()
    : await offlineDb.outbox.toArray();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function pushOutboxOperations(centreId?: string): Promise<{
  synced: number;
  failed: number;
  conflicts: number;
}> {
  const all = await listOutboxOperations(centreId);
  const currentUser = JSON.parse(localStorage.getItem('khorak_user_profile') || 'null');
  const candidates = all.filter(item => item.userId === currentUser?.id &&
    ['saved_locally', 'pending_sync', 'failed'].includes(item.status)).slice(0, 100);

  if (candidates.length === 0) {
    return { synced: 0, failed: 0, conflicts: 0 };
  }

  for (const c of candidates) {
    await offlineDb.outbox.update(c.operationUuid, { status: 'pending_sync' });
  }

  try {
    const res = await apiRequest<{
      success: boolean;
      data: {
        results: Array<{
          operationUuid: string;
          status: 'SYNCED' | 'FAILED' | 'CONFLICT';
          message?: string;
        }>;
      };
    }>('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        operations: candidates.map((c) => ({
          operationUuid: c.operationUuid,
          operationType: c.operationType,
          createdAt: c.createdAt,
          payload: c.payload,
        })),
      }),
    });

    let synced = 0;
    let failed = 0;
    let conflicts = 0;

    for (const r of res.data.results) {
      if (r.status === 'SYNCED') {
        synced++;
        await offlineDb.outbox.update(r.operationUuid, {
          status: 'synced',
          syncedAt: new Date().toISOString(),
          errorMessage: undefined,
        });
      } else if (r.status === 'CONFLICT') {
        conflicts++;
        await offlineDb.outbox.update(r.operationUuid, {
          status: 'conflict',
          errorMessage: r.message || 'Server conflict detected',
        });
      } else {
        failed++;
        const existing = await offlineDb.outbox.get(r.operationUuid);
        await offlineDb.outbox.update(r.operationUuid, {
          status: 'failed',
          retryCount: (existing?.retryCount ?? 0) + 1,
          errorMessage: r.message || 'Synchronisation failed',
        });
      }
    }

    if (centreId) {
      await pullCentreSnapshot(centreId);
    }

    if (synced > 0) window.dispatchEvent(new Event('khorak:data-changed'));
    return { synced, failed, conflicts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network unreachable';
    for (const c of candidates) {
      await offlineDb.outbox.update(c.operationUuid, {
        status: 'saved_locally',
        retryCount: c.retryCount + 1,
        errorMessage: msg,
      });
    }
    return { synced: 0, failed: candidates.length, conflicts: 0 };
  }
}

export async function clearSyncedOutbox(centreId?: string): Promise<void> {
  const all = await listOutboxOperations(centreId);
  const syncedKeys = all.filter((i) => i.status === 'synced').map((i) => i.operationUuid);
  await offlineDb.outbox.bulkDelete(syncedKeys);
}


const pendingSyncs = new Map<string, ReturnType<typeof pushOutboxOperations>>();
export function syncOutboxOperations(centreId?: string) {
  const key = centreId ?? '*';
  const existing = pendingSyncs.get(key);
  if (existing) return existing;
  const pending = pushOutboxOperations(centreId).finally(() => pendingSyncs.delete(key));
  pendingSyncs.set(key, pending);
  return pending;
}
