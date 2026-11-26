import Dexie, { Table } from 'dexie';
import {
  AlertItem,
  BeneficiaryReference,
  DispatchRecord,
  DistributionRecord,
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
  offlineCredentialSalt?: string | null;
  products: Product[];
  inventorySummary: ProductInventorySummary[];
  pendingDispatches: DispatchRecord[];
  beneficiaries: BeneficiaryReference[];
  recentDistributions: DistributionRecord[];
  alerts: AlertItem[];
  stockRequests?: StockRequest[];
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

export async function checkServerConnectivity(timeoutMs = 3500): Promise<boolean> {
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

export async function pullCentreSnapshot(centreId: string): Promise<CachedCentreSnapshot | null> {
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
      offlineCredentialSalt: res.data.centre?.offlineCredentialSalt ?? null,
      products: res.data.products,
      inventorySummary: res.data.inventorySummary,
      pendingDispatches: res.data.pendingDispatches,
      beneficiaries: res.data.beneficiaries,
      recentDistributions: res.data.recentDistributions,
      alerts: res.data.alerts,
      stockRequests: res.data.stockRequests ?? [],
    };
    await offlineDb.snapshots.put(snapshot);
    return snapshot;
  } catch {
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

export async function syncOutboxOperations(centreId?: string): Promise<{
  synced: number;
  failed: number;
  conflicts: number;
}> {
  const all = await listOutboxOperations(centreId);
  const candidates = all.filter(
    (item) =>
      item.status === 'saved_locally' ||
      item.status === 'pending_sync' ||
      item.status === 'failed'
  );

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

