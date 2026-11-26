import { BatchStatus, LedgerEventType, Prisma, ProductCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { daysBetween, roundQty } from '../lib/math';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface BatchBalanceRow {
  batchId: string;
  batchNumber: string;
  productId: string;
  productCode: string;
  productName: string;
  productNameGu: string;
  category: ProductCategory;
  unit: string;
  supplierId: string;
  supplierName: string;
  manufacturingDate: Date | null;
  expiryDate: Date;
  daysToExpiry: number;
  status: BatchStatus;
  balance: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  isUsable: boolean;
}

export type ReorderLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'STOCKOUT';

export interface ProductInventorySummary {
  productId: string;
  productCode: string;
  productName: string;
  productNameGu: string;
  category: ProductCategory;
  unit: string;
  usableStock: number;
  expiredStock: number;
  quarantinedStock: number;
  damagedStock: number;
  totalStock: number;
  averageDailyConsumption: number;
  isConsumptionEstimated: boolean;
  daysOfStock: number | null;
  reorderLevel: ReorderLevel;
  expiringSoonBatches: number;
  expiredBatches: number;
  batches: BatchBalanceRow[];
}

export function classifyReorderLevel(usableStock: number, daysOfStock: number | null): ReorderLevel {
  if (roundQty(usableStock) <= 0) return 'STOCKOUT';
  if (daysOfStock === null) return 'NORMAL';
  if (daysOfStock <= env.reorderCriticalDays) return 'CRITICAL';
  if (daysOfStock <= env.reorderWarningDays) return 'WARNING';
  return 'NORMAL';
}

/**
 * Acquires a PostgreSQL transaction-scoped advisory lock per (centreId, productId)
 * to serialize concurrent stock deductions and prevent negative-balance race conditions.
 */
export async function acquireStockLock(
  tx: Prisma.TransactionClient,
  centreId: string,
  productId: string
): Promise<void> {
  const lockKey = `stock:${centreId}:${productId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export function computeNetFromEvent(eventType: LedgerEventType, quantity: number): number {
  switch (eventType) {
    case LedgerEventType.OPENING_STOCK:
    case LedgerEventType.RECEIVED:
    case LedgerEventType.ADJUSTMENT_IN:
      return quantity;
    case LedgerEventType.DISTRIBUTED:
    case LedgerEventType.CONSUMED:
    case LedgerEventType.SPOILAGE:
    case LedgerEventType.ADJUSTMENT_OUT:
      return -quantity;
    case LedgerEventType.RECONCILIATION:
      // Reconciliation marker events carry zero balance delta; variances emit ADJUSTMENT_IN/OUT
      return 0;
    default:
      return 0;
  }
}

export async function getCentreBatchBalances(
  centreId: string,
  db: DbClient = prisma,
  options?: { productId?: string; includeZero?: boolean }
): Promise<BatchBalanceRow[]> {
  const now = new Date();
  const grouped = await db.stockLedgerEvent.groupBy({
    by: ['productId', 'batchId', 'eventType'],
    where: {
      centreId,
      ...(options?.productId ? { productId: options.productId } : {}),
    },
    _sum: { quantity: true },
  });

  if (grouped.length === 0) return [];

  const batchMap = new Map<string, number>();
  const batchIds = new Set<string>();

  for (const row of grouped) {
    batchIds.add(row.batchId);
    const qty = row._sum.quantity ?? 0;
    const delta = computeNetFromEvent(row.eventType, qty);
    batchMap.set(row.batchId, roundQty((batchMap.get(row.batchId) ?? 0) + delta));
  }

  const batches = await db.productBatch.findMany({
    where: { id: { in: Array.from(batchIds) } },
    include: {
      product: true,
      supplier: true,
    },
    orderBy: { expiryDate: 'asc' },
  });

  const rows: BatchBalanceRow[] = [];
  for (const b of batches) {
    const balance = roundQty(batchMap.get(b.id) ?? 0);
    if (!options?.includeZero && balance <= 0) continue;

    const daysToExpiry = daysBetween(now, b.expiryDate);
    const isExpired = b.expiryDate.getTime() <= now.getTime() || b.status === BatchStatus.EXPIRED;
    const isExpiringSoon = !isExpired && daysToExpiry <= env.expiryWarningDays;
    const isUsable = !isExpired && b.status === BatchStatus.ACTIVE && balance > 0;

    rows.push({
      batchId: b.id,
      batchNumber: b.batchNumber,
      productId: b.productId,
      productCode: b.product.code,
      productName: b.product.name,
      productNameGu: b.product.nameGu,
      category: b.product.category,
      unit: b.product.unit,
      supplierId: b.supplierId,
      supplierName: b.supplier.name,
      manufacturingDate: b.manufacturingDate,
      expiryDate: b.expiryDate,
      daysToExpiry,
      status: b.status,
      balance,
      isExpired,
      isExpiringSoon,
      isUsable,
    });
  }

  // Always sort FEFO: earliest expiry date first
  rows.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  return rows;
}

export async function getCentreInventorySummary(
  centreId: string,
  db: DbClient = prisma
): Promise<ProductInventorySummary[]> {
  const [products, batchRows, consumptionEvents] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    getCentreBatchBalances(centreId, db, { includeZero: false }),
    db.stockLedgerEvent.findMany({
      where: {
        centreId,
        eventType: { in: [LedgerEventType.DISTRIBUTED, LedgerEventType.CONSUMED] },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        productId: true,
        quantity: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const now = new Date();
  const consumptionByProduct = new Map<string, { total: number; earliest: Date; distinctDays: Set<string> }>();
  for (const ev of consumptionEvents) {
    const dayKey = ev.createdAt.toISOString().slice(0, 10);
    const existing = consumptionByProduct.get(ev.productId);
    if (!existing) {
      consumptionByProduct.set(ev.productId, {
        total: ev.quantity,
        earliest: ev.createdAt,
        distinctDays: new Set([dayKey]),
      });
    } else {
      existing.total = roundQty(existing.total + ev.quantity);
      existing.distinctDays.add(dayKey);
    }
  }

  return products.map((product) => {
    const productBatches = batchRows.filter((b) => b.productId === product.id);
    let usableStock = 0;
    let expiredStock = 0;
    let quarantinedStock = 0;
    let damagedStock = 0;
    let expiringSoonBatches = 0;
    let expiredBatches = 0;

    for (const b of productBatches) {
      if (b.isExpired) {
        expiredStock = roundQty(expiredStock + b.balance);
        expiredBatches++;
      } else if (b.status === BatchStatus.QUARANTINED) {
        quarantinedStock = roundQty(quarantinedStock + b.balance);
      } else if (b.status === BatchStatus.DAMAGED) {
        damagedStock = roundQty(damagedStock + b.balance);
      } else if (b.isUsable) {
        usableStock = roundQty(usableStock + b.balance);
        if (b.isExpiringSoon) expiringSoonBatches++;
      }
    }

    const totalStock = roundQty(usableStock + expiredStock + quarantinedStock + damagedStock);
    const cons = consumptionByProduct.get(product.id);

    let avgDaily = product.defaultDailyRate || env.defaultEstimatedDailyConsumption;
    let isEstimated = true;

    if (cons && cons.total > 0) {
      const spanDays = Math.max(1, Math.ceil((now.getTime() - cons.earliest.getTime()) / (24 * 60 * 60 * 1000)));
      const effectiveDays = Math.max(spanDays, cons.distinctDays.size);
      const calculated = roundQty(cons.total / effectiveDays);
      if (cons.distinctDays.size >= 3) {
        avgDaily = calculated;
        isEstimated = false;
      } else if (calculated > 0) {
        avgDaily = calculated;
        isEstimated = true;
      }
    }

    const daysOfStock =
      usableStock <= 0
        ? 0
        : avgDaily > 0
          ? Math.round((usableStock / avgDaily) * 10) / 10
          : null;

    const reorderLevel = classifyReorderLevel(usableStock, daysOfStock);

    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      productNameGu: product.nameGu,
      category: product.category,
      unit: product.unit,
      usableStock,
      expiredStock,
      quarantinedStock,
      damagedStock,
      totalStock,
      averageDailyConsumption: avgDaily,
      isConsumptionEstimated: isEstimated,
      daysOfStock,
      reorderLevel,
      expiringSoonBatches,
      expiredBatches,
      batches: productBatches,
    };
  });
}

export async function allocateFefoBatches(
  db: DbClient,
  params: {
    centreId: string;
    productId: string;
    quantity: number;
    preferredBatchId?: string;
  }
): Promise<Array<{ batchId: string; batchNumber: string; expiryDate: Date; quantity: number }>> {
  const requested = roundQty(params.quantity);
  if (requested <= 0) {
    throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive');
  }

  const allBatches = await getCentreBatchBalances(params.centreId, db, {
    productId: params.productId,
    includeZero: false,
  });

  if (params.preferredBatchId) {
    const specific = allBatches.find((b) => b.batchId === params.preferredBatchId);
    if (!specific) {
      const batchRecord = await db.productBatch.findUnique({ where: { id: params.preferredBatchId } });
      if (!batchRecord || batchRecord.productId !== params.productId) {
        throw new AppError(404, 'BATCH_NOT_FOUND', 'Selected batch not found for this product');
      }
      throw new AppError(400, 'INSUFFICIENT_STOCK', 'Selected batch has zero stock at this centre');
    }
    if (specific.isExpired) {
      throw new AppError(
        400,
        'BATCH_EXPIRED',
        `Batch ${specific.batchNumber} is expired and cannot be distributed or consumed`
      );
    }
    if (specific.status !== BatchStatus.ACTIVE) {
      throw new AppError(
        400,
        'BATCH_UNUSABLE',
        `Batch ${specific.batchNumber} is ${specific.status.toLowerCase()} and cannot be used`
      );
    }
    if (specific.balance < requested) {
      throw new AppError(
        400,
        'INSUFFICIENT_STOCK',
        `Insufficient usable stock in batch ${specific.batchNumber}. Available: ${specific.balance}, Requested: ${requested}`
      );
    }
    return [
      {
        batchId: specific.batchId,
        batchNumber: specific.batchNumber,
        expiryDate: specific.expiryDate,
        quantity: requested,
      },
    ];
  }

  const usableBatches = allBatches.filter((b) => b.isUsable);
  const totalUsable = roundQty(usableBatches.reduce((sum, b) => sum + b.balance, 0));

  if (totalUsable < requested) {
    throw new AppError(
      400,
      'INSUFFICIENT_STOCK',
      `Insufficient usable stock. Available: ${totalUsable}, Requested: ${requested}`
    );
  }

  // FEFO allocation: earliest expiry first
  const allocations: Array<{ batchId: string; batchNumber: string; expiryDate: Date; quantity: number }> = [];
  let remaining = requested;

  for (const batch of usableBatches) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(batch.balance, remaining));
    if (take > 0) {
      allocations.push({
        batchId: batch.batchId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity: take,
      });
      remaining = roundQty(remaining - take);
    }
  }

  return allocations;
}

