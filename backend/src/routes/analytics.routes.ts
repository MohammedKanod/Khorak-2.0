import { Router } from 'express';
import { DiscrepancyStatus, DispatchStatus, LedgerEventType, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCentreInScope,
  buildCentreScopeWhere,
  requireAuth,
  requireRoles,
} from '../middleware/auth';
import { getCentreInventorySummary } from '../services/ledger.service';
import { roundQty } from '../lib/math';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get('/alerts', async (req, res, next) => {
  try {
    if (req.user!.role === Role.SUPPLIER) {
      const discrepancies = await prisma.discrepancyCase.findMany({
        where: {
          dispatch: { supplierId: req.user!.supplierId ?? '__none__' },
          status: { in: [DiscrepancyStatus.OPEN, DiscrepancyStatus.RECOUNT_REQUESTED] },
        },
        include: {
          dispatch: { select: { dispatchReference: true, destinationCentre: { select: { name: true, code: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ success: true, data: discrepancies });
    }

    const alerts = await prisma.alert.findMany({
      where: {
        centre: buildCentreScopeWhere(req.user!),
        isResolved: false,
      },
      include: {
        centre: {
          select: {
            id: true,
            name: true,
            nameGu: true,
            code: true,
            sector: { select: { name: true, block: { select: { id: true, name: true } } } },
          },
        },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 250,
    });

    res.json({ success: true, data: alerts });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get(
  '/dashboard/centre',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const centreId =
        typeof req.query.centreId === 'string' ? req.query.centreId : req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId query parameter is required');
      }

      const centre = await assertCentreInScope(req.user!, centreId);
      const [inventory, pendingDispatches, alerts, recentDistributions, recentLedger] =
        await Promise.all([
          getCentreInventorySummary(centre.id),
          prisma.dispatch.findMany({
            where: {
              destinationCentreId: centre.id,
              status: DispatchStatus.DISPATCHED,
            },
            include: {
              supplier: { select: { id: true, name: true } },
              items: { include: { product: true, batch: true } },
            },
            orderBy: { dispatchDate: 'desc' },
          }),
          prisma.alert.findMany({
            where: { centreId: centre.id, isResolved: false },
            orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          }),
          prisma.distribution.findMany({
            where: { centreId: centre.id },
            include: {
              beneficiary: { select: { localReference: true, displayName: true, displayNameGu: true, maskedIdLast4: true } },
              product: { select: { name: true, nameGu: true, unit: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { distributedAt: 'desc' },
            take: 15,
          }),
          prisma.stockLedgerEvent.findMany({
            where: { centreId: centre.id },
            include: {
              product: { select: { name: true, nameGu: true, unit: true } },
              batch: { select: { batchNumber: true } },
              actor: { select: { name: true, role: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
        ]);

      res.json({
        success: true,
        data: {
          centre,
          inventory,
          pendingDispatches,
          alerts,
          recentDistributions,
          recentLedger,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

async function computeAggregatedMetrics(centreFilter: Record<string, unknown>) {
  const centres = await prisma.anganwadiCentre.findMany({
    where: { ...centreFilter, isActive: true },
    include: {
      sector: { include: { block: { select: { id: true, name: true, code: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  const centreIds = centres.map((c) => c.id);

  const [dispatches, discrepancies, alerts, ledgerEvents] = await Promise.all([
    prisma.dispatch.findMany({
      where: { destinationCentreId: { in: centreIds } },
      include: { deliveryReceipt: true, supplier: { select: { id: true, name: true } } },
    }),
    prisma.discrepancyCase.findMany({
      where: { dispatch: { destinationCentreId: { in: centreIds } } },
    }),
    prisma.alert.findMany({
      where: { centreId: { in: centreIds }, isResolved: false },
    }),
    prisma.stockLedgerEvent.findMany({
      where: { centreId: { in: centreIds } },
      select: { centreId: true, eventType: true, quantity: true },
    }),
  ]);

  let totalUsableStock = 0;
  let centresBelowSevenDays = 0;
  let stockoutCentres = 0;
  let expiringBatchesCount = 0;

  const blockAggMap = new Map<
    string,
    {
      blockId: string;
      blockName: string;
      centresCount: number;
      usableStock: number;
      stockoutCentres: number;
      lowStockCentres: number;
      distributedQty: number;
      receivedQty: number;
    }
  >();

  const centreRows = [];

  const summaries = await Promise.all(
    centres.map((c) => getCentreInventorySummary(c.id))
  );

  for (let i = 0; i < centres.length; i++) {
    const c = centres[i];
    const summary = summaries[i];
    const cUsable = roundQty(summary.reduce((s, p) => s + p.usableStock, 0));
    const hasLow = summary.some(
      (p) => p.reorderLevel === 'WARNING' || p.reorderLevel === 'CRITICAL'
    );
    const hasStockout = summary.some((p) => p.reorderLevel === 'STOCKOUT');
    const expSoon = summary.reduce((s, p) => s + p.expiringSoonBatches, 0);

    totalUsableStock = roundQty(totalUsableStock + cUsable);
    if (hasLow || hasStockout) centresBelowSevenDays++;
    if (hasStockout) stockoutCentres++;
    expiringBatchesCount += expSoon;

    const blockId = c.sector.block.id;
    const bEntry = blockAggMap.get(blockId) || {
      blockId,
      blockName: c.sector.block.name,
      centresCount: 0,
      usableStock: 0,
      stockoutCentres: 0,
      lowStockCentres: 0,
      distributedQty: 0,
      receivedQty: 0,
    };
    bEntry.centresCount++;
    bEntry.usableStock = roundQty(bEntry.usableStock + cUsable);
    if (hasStockout) bEntry.stockoutCentres++;
    if (hasLow || hasStockout) bEntry.lowStockCentres++;
    blockAggMap.set(blockId, bEntry);

    centreRows.push({
      centreId: c.id,
      centreName: c.name,
      centreNameGu: c.nameGu,
      code: c.code,
      sectorName: c.sector.name,
      blockId,
      blockName: c.sector.block.name,
      usableStock: cUsable,
      expiringSoonBatches: expSoon,
      hasStockout,
      hasLowStock: hasLow,
      products: summary,
    });
  }

  let totalReceived = 0;
  let totalDistributed = 0;
  const blockByCentre = new Map(centres.map((c) => [c.id, c.sector.block.id]));

  for (const ev of ledgerEvents) {
    const bId = blockByCentre.get(ev.centreId);
    const bEntry = bId ? blockAggMap.get(bId) : undefined;
    if (ev.eventType === LedgerEventType.RECEIVED || ev.eventType === LedgerEventType.OPENING_STOCK) {
      totalReceived = roundQty(totalReceived + ev.quantity);
      if (bEntry) bEntry.receivedQty = roundQty(bEntry.receivedQty + ev.quantity);
    } else if (
      ev.eventType === LedgerEventType.DISTRIBUTED ||
      ev.eventType === LedgerEventType.CONSUMED
    ) {
      totalDistributed = roundQty(totalDistributed + ev.quantity);
      if (bEntry) bEntry.distributedQty = roundQty(bEntry.distributedQty + ev.quantity);
    }
  }

  const pendingDeliveries = dispatches.filter((d) => d.status === DispatchStatus.DISPATCHED).length;
  const completedDispatches = dispatches.filter((d) => d.deliveryReceipt !== null);
  let sumExpected = 0;
  let sumAccepted = 0;
  for (const d of completedDispatches) {
    if (d.deliveryReceipt) {
      sumExpected += d.deliveryReceipt.expectedQuantity;
      sumAccepted += d.deliveryReceipt.acceptedQuantity;
    }
  }
  const deliveryFulfilmentPct =
    sumExpected > 0 ? Math.round((sumAccepted / sumExpected) * 1000) / 10 : 100;

  const distributionEfficiencyPct =
    totalReceived > 0
      ? Math.min(100, Math.round((totalDistributed / totalReceived) * 1000) / 10)
      : 0;

  const unresolvedDiscrepancies = discrepancies.filter(
    (d) =>
      d.status === DiscrepancyStatus.OPEN || d.status === DiscrepancyStatus.RECOUNT_REQUESTED
  ).length;

  return {
    kpis: {
      totalCentres: centres.length,
      totalUsableStock,
      centresBelowSevenDays,
      stockoutCentres,
      expiringBatchesCount,
      pendingDeliveries,
      deliveryFulfilmentPct,
      distributionEfficiencyPct,
      unresolvedDiscrepancies,
      activeAlertsCount: alerts.length,
    },
    blocks: Array.from(blockAggMap.values()),
    centres: centreRows,
  };
}

analyticsRouter.get(
  '/dashboard/block',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.TDO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const requestedBlockId = typeof req.query.blockId === 'string' ? req.query.blockId : undefined;
      let scopeWhere = buildCentreScopeWhere(req.user!);
      if (requestedBlockId && (req.user!.role === Role.DPO || req.user!.role === Role.DDO)) {
        scopeWhere = { ...scopeWhere, sector: { blockId: requestedBlockId } };
      }

      const data = await computeAggregatedMetrics(scopeWhere);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/dashboard/district',
  requireRoles(Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const scopeWhere = buildCentreScopeWhere(req.user!);
      const metrics = await computeAggregatedMetrics(scopeWhere);

      const nutritionRows = await prisma.nutritionAggregate.findMany({
        where: req.user!.districtId
          ? { block: { districtId: req.user!.districtId } }
          : undefined,
        include: { block: { select: { id: true, name: true } } },
        orderBy: [{ reportingPeriod: 'asc' }, { block: { name: 'asc' } }],
      });

      res.json({
        success: true,
        data: {
          ...metrics,
          nutritionIndicators: nutritionRows,
          nutritionDataNotice:
            'Aggregated block-level nutrition indicators are labelled synthetic demonstration data (complements POSHAN Tracker).',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/analytics/inventory',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.TDO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const metrics = await computeAggregatedMetrics(buildCentreScopeWhere(req.user!));
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/analytics/distribution',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.TDO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const scopeWhere = buildCentreScopeWhere(req.user!);
      const distributions = await prisma.distribution.findMany({
        where: { centre: scopeWhere },
        include: {
          product: { select: { id: true, name: true, nameGu: true, category: true, unit: true } },
          centre: {
            select: {
              id: true,
              name: true,
              sector: { select: { block: { select: { id: true, name: true } } } },
            },
          },
        },
        orderBy: { distributedAt: 'desc' },
        take: 500,
      });

      const byDayMap = new Map<string, { day: string; totalQuantity: number; count: number }>();
      const byProductMap = new Map<string, { productName: string; unit: string; totalQuantity: number; count: number }>();

      for (const d of distributions) {
        const day = d.distributionDay;
        const dayItem = byDayMap.get(day) || { day, totalQuantity: 0, count: 0 };
        dayItem.totalQuantity = roundQty(dayItem.totalQuantity + d.quantity);
        dayItem.count++;
        byDayMap.set(day, dayItem);

        const pItem = byProductMap.get(d.productId) || {
          productName: d.product.name,
          unit: d.product.unit,
          totalQuantity: 0,
          count: 0,
        };
        pItem.totalQuantity = roundQty(pItem.totalQuantity + d.quantity);
        pItem.count++;
        byProductMap.set(d.productId, pItem);
      }

      res.json({
        success: true,
        data: {
          dailyTrend: Array.from(byDayMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
          byProduct: Array.from(byProductMap.values()),
          totalTransactions: distributions.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/analytics/suppliers',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.TDO, Role.DPO, Role.DDO, Role.SUPPLIER),
  async (req, res, next) => {
    try {
      const dispatchWhere =
        req.user!.role === Role.SUPPLIER
          ? { supplierId: req.user!.supplierId ?? '__none__' }
          : { destinationCentre: buildCentreScopeWhere(req.user!) };

      const dispatches = await prisma.dispatch.findMany({
        where: dispatchWhere,
        include: {
          supplier: { select: { id: true, name: true, code: true, status: true } },
          deliveryReceipt: true,
          discrepancyCases: true,
        },
      });

      const supplierMap = new Map<
        string,
        {
          supplierId: string;
          supplierName: string;
          code: string;
          totalDispatches: number;
          deliveredCount: number;
          discrepancyCount: number;
          pendingCount: number;
          expectedQty: number;
          acceptedQty: number;
          fulfilmentRatePct: number;
        }
      >();

      for (const d of dispatches) {
        const entry = supplierMap.get(d.supplierId) || {
          supplierId: d.supplier.id,
          supplierName: d.supplier.name,
          code: d.supplier.code,
          totalDispatches: 0,
          deliveredCount: 0,
          discrepancyCount: 0,
          pendingCount: 0,
          expectedQty: 0,
          acceptedQty: 0,
          fulfilmentRatePct: 100,
        };
        entry.totalDispatches++;
        if (d.status === DispatchStatus.DELIVERED) entry.deliveredCount++;
        if (d.status === DispatchStatus.DISCREPANCY) entry.discrepancyCount++;
        if (d.status === DispatchStatus.DISPATCHED) entry.pendingCount++;
        if (d.deliveryReceipt) {
          entry.expectedQty = roundQty(entry.expectedQty + d.deliveryReceipt.expectedQuantity);
          entry.acceptedQty = roundQty(entry.acceptedQty + d.deliveryReceipt.acceptedQuantity);
        }
        entry.fulfilmentRatePct =
          entry.expectedQty > 0
            ? Math.round((entry.acceptedQty / entry.expectedQty) * 1000) / 10
            : 100;
        supplierMap.set(d.supplierId, entry);
      }

      res.json({ success: true, data: Array.from(supplierMap.values()) });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/analytics/nutrition',
  requireRoles(Role.DPO, Role.DDO, Role.CDPO, Role.TDO),
  async (req, res, next) => {
    try {
      const blockFilter =
        req.user!.role === Role.CDPO || req.user!.role === Role.TDO
          ? { blockId: req.user!.blockId ?? '__none__' }
          : req.user!.districtId
            ? { block: { districtId: req.user!.districtId } }
            : {};

      const rows = await prisma.nutritionAggregate.findMany({
        where: blockFilter,
        include: { block: { select: { id: true, name: true } } },
        orderBy: [{ reportingPeriod: 'asc' }, { block: { name: 'asc' } }],
      });

      res.json({
        success: true,
        data: {
          records: rows,
          isSyntheticDemo: true,
          disclaimer:
            'Demonstration aggregate data only — complements POSHAN Tracker without duplicating child growth monitoring.',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

analyticsRouter.get(
  '/dashboard/admin-bundle',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.TDO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const scopeWhere = buildCentreScopeWhere(req.user!);
      const isDistrictLevel = req.user!.role === Role.DPO || req.user!.role === Role.DDO;

      const [
        baseMetrics,
        discrepancies,
        spoilages,
        reconciliations,
        alerts,
        dispatches,
        distributions,
        beneficiaries,
        nutritionRows,
      ] = await Promise.all([
        computeAggregatedMetrics(scopeWhere),
        prisma.discrepancyCase.findMany({
          where: { dispatch: { destinationCentre: scopeWhere } },
          include: {
            dispatch: {
              include: {
                supplier: { select: { id: true, name: true, code: true } },
                destinationCentre: {
                  select: {
                    id: true,
                    name: true,
                    nameGu: true,
                    code: true,
                    sector: { select: { id: true, name: true, block: { select: { id: true, name: true } } } },
                  },
                },
                items: {
                  include: {
                    product: { select: { id: true, name: true, nameGu: true, unit: true } },
                    batch: { select: { id: true, batchNumber: true } },
                  },
                },
              },
            },
            deliveryReceipt: {
              select: {
                id: true,
                evidenceUrl: true,
                notes: true,
                receivedAt: true,
                receiver: { select: { id: true, name: true, role: true } },
              },
            },
            resolver: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 150,
        }),
        prisma.spoilageReport.findMany({
          where: { centre: scopeWhere },
          include: {
            centre: { select: { id: true, name: true, nameGu: true, code: true } },
            product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            reporter: { select: { id: true, name: true, role: true } },
            reviewer: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.reconciliation.findMany({
          where: { centre: scopeWhere },
          include: {
            centre: { select: { id: true, name: true, nameGu: true, code: true } },
            product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            verifier: { select: { id: true, name: true, role: true } },
            approver: { select: { id: true, name: true, role: true } },
          },
          orderBy: { verifiedAt: 'desc' },
          take: 100,
        }),
        prisma.alert.findMany({
          where: { centre: scopeWhere, isResolved: false },
          include: {
            centre: {
              select: {
                id: true,
                name: true,
                nameGu: true,
                code: true,
                sector: { select: { name: true, block: { select: { id: true, name: true } } } },
              },
            },
            product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          },
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          take: 250,
        }),
        prisma.dispatch.findMany({
          where: { destinationCentre: scopeWhere },
          include: {
            supplier: { select: { id: true, name: true, code: true } },
            destinationCentre: {
              select: {
                id: true,
                name: true,
                nameGu: true,
                code: true,
                location: true,
                sector: { select: { id: true, name: true, block: { select: { id: true, name: true } } } },
              },
            },
            items: {
              include: {
                product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
                batch: { select: { id: true, batchNumber: true, expiryDate: true, status: true } },
              },
            },
            deliveryReceipt: {
              include: {
                receiver: { select: { id: true, name: true, role: true } },
              },
            },
            discrepancyCases: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 150,
        }),
        prisma.distribution.findMany({
          where: { centre: scopeWhere },
          include: {
            product: { select: { id: true, name: true, nameGu: true, category: true, unit: true } },
          },
          orderBy: { distributedAt: 'desc' },
          take: 500,
        }),
        prisma.beneficiaryReference.findMany({
          where: { centre: scopeWhere, isActive: true },
          select: {
            id: true,
            centreId: true,
            localReference: true,
            displayName: true,
            displayNameGu: true,
            maskedIdLast4: true,
            yob: true,
            beneficiaryCategory: true,
            protectedCredentialReference: true,
            status: true,
            reviewRemarks: true,
            reviewedAt: true,
            createdAt: true,
            centre: { select: { id: true, name: true, nameGu: true, code: true } },
            requester: { select: { id: true, name: true, role: true } },
            reviewer: { select: { id: true, name: true, role: true } },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        }),
        isDistrictLevel
          ? prisma.nutritionAggregate.findMany({
              where: req.user!.districtId
                ? { block: { districtId: req.user!.districtId } }
                : undefined,
              include: { block: { select: { id: true, name: true } } },
              orderBy: [{ reportingPeriod: 'asc' }, { block: { name: 'asc' } }],
            })
          : Promise.resolve(undefined),
      ]);

      // Derive supplier performance from already-fetched dispatches
      const supplierMap = new Map<
        string,
        {
          supplierId: string;
          supplierName: string;
          code: string;
          totalDispatches: number;
          deliveredCount: number;
          discrepancyCount: number;
          pendingCount: number;
          expectedQty: number;
          acceptedQty: number;
          fulfilmentRatePct: number;
        }
      >();

      for (const d of dispatches) {
        const entry = supplierMap.get(d.supplierId) || {
          supplierId: d.supplier.id,
          supplierName: d.supplier.name,
          code: d.supplier.code,
          totalDispatches: 0,
          deliveredCount: 0,
          discrepancyCount: 0,
          pendingCount: 0,
          expectedQty: 0,
          acceptedQty: 0,
          fulfilmentRatePct: 100,
        };
        entry.totalDispatches++;
        if (d.status === DispatchStatus.DELIVERED) entry.deliveredCount++;
        if (d.status === DispatchStatus.DISCREPANCY) entry.discrepancyCount++;
        if (d.status === DispatchStatus.DISPATCHED) entry.pendingCount++;
        if (d.deliveryReceipt) {
          entry.expectedQty = roundQty(entry.expectedQty + d.deliveryReceipt.expectedQuantity);
          entry.acceptedQty = roundQty(entry.acceptedQty + d.deliveryReceipt.acceptedQuantity);
        }
        entry.fulfilmentRatePct =
          entry.expectedQty > 0
            ? Math.round((entry.acceptedQty / entry.expectedQty) * 1000) / 10
            : 100;
        supplierMap.set(d.supplierId, entry);
      }

      // Derive distribution trends from already-fetched distributions
      const byDayMap = new Map<string, { day: string; totalQuantity: number; count: number }>();
      const byProductMap = new Map<
        string,
        { productName: string; unit: string; totalQuantity: number; count: number }
      >();

      for (const d of distributions) {
        const dayItem = byDayMap.get(d.distributionDay) || {
          day: d.distributionDay,
          totalQuantity: 0,
          count: 0,
        };
        dayItem.totalQuantity = roundQty(dayItem.totalQuantity + d.quantity);
        dayItem.count++;
        byDayMap.set(d.distributionDay, dayItem);

        const pItem = byProductMap.get(d.productId) || {
          productName: d.product.name,
          unit: d.product.unit,
          totalQuantity: 0,
          count: 0,
        };
        pItem.totalQuantity = roundQty(pItem.totalQuantity + d.quantity);
        pItem.count++;
        byProductMap.set(d.productId, pItem);
      }

      res.json({
        success: true,
        data: {
          metrics: {
            ...baseMetrics,
            ...(isDistrictLevel
              ? {
                  nutritionIndicators: nutritionRows,
                  nutritionDataNotice:
                    'Aggregated block-level nutrition indicators are labelled synthetic demonstration data (complements POSHAN Tracker).',
                }
              : {}),
          },
          discrepancies,
          spoilages,
          reconciliations,
          alerts,
          dispatches,
          supplierPerf: Array.from(supplierMap.values()),
          distAnalytics: {
            dailyTrend: Array.from(byDayMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
            byProduct: Array.from(byProductMap.values()),
            totalTransactions: distributions.length,
          },
          beneficiaries,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

