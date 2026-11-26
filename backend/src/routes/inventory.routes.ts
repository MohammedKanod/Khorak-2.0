import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  BatchStatus,
  LedgerEventType,
  ReconciliationStatus,
  Role,
  SpoilageStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCentreInScope,
  buildCentreScopeWhere,
  requireAuth,
  requireRoles,
} from '../middleware/auth';
import {
  acquireStockLock,
  allocateFefoBatches,
  getCentreBatchBalances,
  getCentreInventorySummary,
} from '../services/ledger.service';
import { refreshCentreAlerts } from '../services/alert.service';
import { recordAuditLog } from '../lib/audit';
import { roundQty } from '../lib/math';
import { evidenceUpload } from '../middleware/upload';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

inventoryRouter.get('/products', async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/spoilage', async (req, res, next) => {
  try {
    const centreWhere = buildCentreScopeWhere(req.user!);
    const reports = await prisma.spoilageReport.findMany({
      where: { centre: centreWhere },
      include: {
        centre: { select: { id: true, name: true, nameGu: true, code: true } },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        reporter: { select: { id: true, name: true, role: true } },
        reviewer: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/reconciliations', async (req, res, next) => {
  try {
    const centreWhere = buildCentreScopeWhere(req.user!);
    const rows = await prisma.reconciliation.findMany({
      where: { centre: centreWhere },
      include: {
        centre: { select: { id: true, name: true, nameGu: true, code: true } },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        verifier: { select: { id: true, name: true, role: true } },
        approver: { select: { id: true, name: true, role: true } },
      },
      orderBy: { verifiedAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/', async (req, res, next) => {
  try {
    if (req.user!.role === Role.SUPPLIER) {
      throw new AppError(403, 'FORBIDDEN', 'Suppliers cannot query centre inventories');
    }

    const requestedCentreId =
      typeof req.query.centreId === 'string' ? req.query.centreId : undefined;
    const category =
      req.query.category === 'THR' || req.query.category === 'HCM'
        ? req.query.category
        : undefined;

    const scopeWhere = buildCentreScopeWhere(req.user!);
    const centres = await prisma.anganwadiCentre.findMany({
      where: {
        ...scopeWhere,
        ...(requestedCentreId ? { id: requestedCentreId } : {}),
      },
      include: {
        sector: {
          include: { block: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (requestedCentreId && centres.length === 0) {
      throw new AppError(403, 'SCOPE_FORBIDDEN', 'Requested centre is outside your scope');
    }

    const results = await Promise.all(
      centres.map(async (centre) => {
        const summary = await getCentreInventorySummary(centre.id);
        const filtered = category
          ? summary.filter((s) => s.category === category)
          : summary;
        return {
          centre: {
            id: centre.id,
            name: centre.name,
            nameGu: centre.nameGu,
            code: centre.code,
            location: centre.location,
            sectorName: centre.sector.name,
            blockName: centre.sector.block.name,
          },
          products: filtered,
        };
      })
    );

    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:centreId', async (req, res, next) => {
  try {
    const centre = await assertCentreInScope(req.user!, String(req.params.centreId));
    const summary = await getCentreInventorySummary(centre.id);
    const category =
      req.query.category === 'THR' || req.query.category === 'HCM'
        ? req.query.category
        : undefined;

    res.json({
      success: true,
      data: {
        centre,
        products: category ? summary.filter((p) => p.category === category) : summary,
      },
    });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:centreId/batches', async (req, res, next) => {
  try {
    const centre = await assertCentreInScope(req.user!, String(req.params.centreId));
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const includeZero = req.query.includeZero === 'true';
    const batches = await getCentreBatchBalances(centre.id, prisma, {
      productId,
      includeZero,
    });
    res.json({ success: true, data: batches });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:centreId/ledger', async (req, res, next) => {
  try {
    const centre = await assertCentreInScope(req.user!, String(req.params.centreId));
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const events = await prisma.stockLedgerEvent.findMany({
      where: {
        centreId: centre.id,
        ...(productId ? { productId } : {}),
      },
      include: {
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        actor: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

const receiptSchema = z.object({
  centreId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchNumber: z.string().min(2).max(60).trim(),
  supplierId: z.string().uuid(),
  expiryDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  manufacturingDate: z.string().optional(),
  quantity: z.number().positive(),
  eventType: z.enum(['OPENING_STOCK', 'RECEIVED']).default('RECEIVED'),
  remarks: z.string().max(300).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

inventoryRouter.post(
  '/receipts',
  requireRoles(Role.AWW, Role.SUPERVISOR, Role.CDPO),
  async (req, res, next) => {
    try {
      const parsed = receiptSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const idempotencyKey = parsed.idempotencyKey || `rcpt-${crypto.randomUUID()}`;

      const existing = await prisma.stockLedgerEvent.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return res.json({ success: true, data: existing, deduplicated: true });
      }

      const [product, supplier] = await Promise.all([
        prisma.product.findUnique({ where: { id: parsed.productId } }),
        prisma.supplier.findUnique({ where: { id: parsed.supplierId } }),
      ]);
      if (!product || !product.isActive) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      }
      if (!supplier) {
        throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
      }

      const expiryDate = new Date(parsed.expiryDate);
      const mfgDate = parsed.manufacturingDate ? new Date(parsed.manufacturingDate) : null;

      const event = await prisma.$transaction(async (tx) => {
        const batch = await tx.productBatch.upsert({
          where: {
            productId_batchNumber_supplierId: {
              productId: parsed.productId,
              batchNumber: parsed.batchNumber,
              supplierId: parsed.supplierId,
            },
          },
          update: {},
          create: {
            productId: parsed.productId,
            batchNumber: parsed.batchNumber,
            supplierId: parsed.supplierId,
            expiryDate,
            manufacturingDate: mfgDate,
            status: expiryDate <= new Date() ? BatchStatus.EXPIRED : BatchStatus.ACTIVE,
          },
        });

        const created = await tx.stockLedgerEvent.create({
          data: {
            centreId,
            productId: parsed.productId,
            batchId: batch.id,
            eventType: parsed.eventType as LedgerEventType,
            quantity: roundQty(parsed.quantity),
            referenceType: 'DIRECT_RECEIPT',
            remarks: parsed.remarks,
            idempotencyKey,
            createdBy: req.user!.id,
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'STOCK_RECEIPT',
          entityType: 'StockLedgerEvent',
          entityId: created.id,
          afterState: created,
          remarks: parsed.remarks,
        });

        return created;
      });

      await refreshCentreAlerts(centreId);
      res.status(201).json({ success: true, data: event });
    } catch (err) {
      next(err);
    }
  }
);

const consumptionSchema = z.object({
  centreId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  quantity: z.number().positive(),
  remarks: z.string().max(300).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

inventoryRouter.post(
  '/consumption',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const parsed = consumptionSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const baseKey = parsed.idempotencyKey || `cons-${crypto.randomUUID()}`;

      const existing = await prisma.stockLedgerEvent.findFirst({
        where: { idempotencyKey: { startsWith: `${baseKey}` } },
      });
      if (existing) {
        return res.json({ success: true, data: [existing], deduplicated: true });
      }

      const product = await prisma.product.findUnique({ where: { id: parsed.productId } });
      if (!product || !product.isActive) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      }

      const events = await prisma.$transaction(async (tx) => {
        await acquireStockLock(tx, centreId, parsed.productId);
        const allocations = await allocateFefoBatches(tx, {
          centreId,
          productId: parsed.productId,
          quantity: parsed.quantity,
          preferredBatchId: parsed.batchId,
        });

        const createdEvents = [];
        for (let i = 0; i < allocations.length; i++) {
          const alloc = allocations[i];
          const ev = await tx.stockLedgerEvent.create({
            data: {
              centreId,
              productId: parsed.productId,
              batchId: alloc.batchId,
              eventType: LedgerEventType.CONSUMED,
              quantity: alloc.quantity,
              referenceType: 'CONSUMPTION',
              remarks: parsed.remarks || `Usage from batch ${alloc.batchNumber}`,
              idempotencyKey: allocations.length === 1 ? baseKey : `${baseKey}-${i}`,
              createdBy: req.user!.id,
            },
          });
          createdEvents.push(ev);
        }

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'STOCK_CONSUMPTION',
          entityType: 'StockLedgerEvent',
          entityId: createdEvents[0].id,
          afterState: createdEvents,
          remarks: parsed.remarks,
        });

        return createdEvents;
      });

      await refreshCentreAlerts(centreId);
      res.status(201).json({ success: true, data: events });
    } catch (err) {
      next(err);
    }
  }
);

const spoilageSchema = z.object({
  centreId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  reason: z.string().min(3).max(200).trim(),
  remarks: z.string().max(400).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

inventoryRouter.post(
  '/spoilage',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const parsed = spoilageSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const idempotencyKey = parsed.idempotencyKey || `spoil-${crypto.randomUUID()}`;

      const existing = await prisma.spoilageReport.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return res.json({ success: true, data: existing, deduplicated: true });
      }

      const batches = await getCentreBatchBalances(centreId, prisma, {
        productId: parsed.productId,
        includeZero: true,
      });
      const targetBatch = batches.find((b) => b.batchId === parsed.batchId);
      if (!targetBatch) {
        throw new AppError(404, 'BATCH_NOT_FOUND', 'Batch has no stock record at this centre');
      }
      if (targetBatch.balance < roundQty(parsed.quantity)) {
        throw new AppError(
          400,
          'INSUFFICIENT_STOCK',
          `Cannot report spoilage of ${parsed.quantity}; batch balance is ${targetBatch.balance}`
        );
      }

      const evidenceReference = req.file ? `/uploads/${req.file.filename}` : null;
      const autoApprove = req.user!.role === Role.SUPERVISOR;

      const report = await prisma.$transaction(async (tx) => {
        const created = await tx.spoilageReport.create({
          data: {
            centreId,
            productId: parsed.productId,
            batchId: parsed.batchId,
            quantity: roundQty(parsed.quantity),
            reason: parsed.reason,
            evidenceReference,
            remarks: parsed.remarks,
            status: autoApprove ? SpoilageStatus.APPROVED : SpoilageStatus.PENDING,
            reportedBy: req.user!.id,
            reviewedBy: autoApprove ? req.user!.id : null,
            reviewRemarks: autoApprove ? 'Verified and recorded by Supervisor' : null,
            reviewedAt: autoApprove ? new Date() : null,
            idempotencyKey,
          },
          include: {
            product: true,
            batch: true,
          },
        });

        if (autoApprove) {
          await tx.stockLedgerEvent.create({
            data: {
              centreId,
              productId: parsed.productId,
              batchId: parsed.batchId,
              eventType: LedgerEventType.SPOILAGE,
              quantity: roundQty(parsed.quantity),
              referenceId: created.id,
              referenceType: 'SPOILAGE_REPORT',
              remarks: `Approved spoilage: ${parsed.reason}`,
              idempotencyKey: `spoil-ev-${created.id}`,
              createdBy: req.user!.id,
            },
          });
        }

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: autoApprove ? 'SPOILAGE_APPROVED' : 'SPOILAGE_REPORTED',
          entityType: 'SpoilageReport',
          entityId: created.id,
          afterState: created,
          remarks: parsed.reason,
        });

        return created;
      });

      await refreshCentreAlerts(centreId);
      res.status(201).json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);

const reconciliationSchema = z.object({
  centreId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  physicalStock: z.number().min(0),
  remarks: z.string().min(3).max(400).trim(),
  autoApprove: z.boolean().optional(),
});

inventoryRouter.post(
  '/reconciliation',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.AWW),
  async (req, res, next) => {
    try {
      const parsed = reconciliationSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const batches = await getCentreBatchBalances(centreId, prisma, {
        productId: parsed.productId,
        includeZero: true,
      });
      const targetBatch = batches.find((b) => b.batchId === parsed.batchId);
      if (!targetBatch) {
        throw new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found in centre ledger');
      }

      const calculatedStock = roundQty(targetBatch.balance);
      const physicalStock = roundQty(parsed.physicalStock);
      const variance = roundQty(physicalStock - calculatedStock);

      const canApproveImmediately =
        (req.user!.role === Role.SUPERVISOR || req.user!.role === Role.CDPO) &&
        parsed.autoApprove === true;

      const reconciliation = await prisma.$transaction(async (tx) => {
        if (canApproveImmediately && variance !== 0) {
          await acquireStockLock(tx, centreId, parsed.productId);
          const lockedBatches = await getCentreBatchBalances(centreId, tx, {
            productId: parsed.productId,
            includeZero: true,
          });
          const lockedTarget = lockedBatches.find((b) => b.batchId === parsed.batchId);
          if (!lockedTarget || roundQty(lockedTarget.balance + variance) < 0) {
            throw new AppError(409, 'NEGATIVE_STOCK_PREVENTED', 'Reconciliation adjustment would drive batch balance negative');
          }
        }
        const created = await tx.reconciliation.create({
          data: {
            centreId,
            productId: parsed.productId,
            batchId: parsed.batchId,
            calculatedStock,
            physicalStock,
            variance,
            status: canApproveImmediately
              ? ReconciliationStatus.APPROVED
              : ReconciliationStatus.PENDING_APPROVAL,
            remarks: parsed.remarks,
            verifiedBy: req.user!.id,
            approvedBy: canApproveImmediately ? req.user!.id : null,
            approvalRemarks: canApproveImmediately ? parsed.remarks : null,
            approvedAt: canApproveImmediately ? new Date() : null,
          },
          include: {
            product: true,
            batch: true,
            centre: { select: { id: true, name: true, code: true } },
          },
        });

        if (canApproveImmediately) {
          if (variance !== 0) {
            await tx.stockLedgerEvent.create({
              data: {
                centreId,
                productId: parsed.productId,
                batchId: parsed.batchId,
                eventType:
                  variance > 0 ? LedgerEventType.ADJUSTMENT_IN : LedgerEventType.ADJUSTMENT_OUT,
                quantity: Math.abs(variance),
                referenceId: created.id,
                referenceType: 'RECONCILIATION',
                remarks: `Physical reconciliation variance (${variance}): ${parsed.remarks}`,
                idempotencyKey: `recon-adj-${created.id}`,
                createdBy: req.user!.id,
              },
            });
          } else {
            await tx.stockLedgerEvent.create({
              data: {
                centreId,
                productId: parsed.productId,
                batchId: parsed.batchId,
                eventType: LedgerEventType.RECONCILIATION,
                quantity: 0,
                referenceId: created.id,
                referenceType: 'RECONCILIATION',
                remarks: `Physical count matched ledger (${physicalStock})`,
                idempotencyKey: `recon-match-${created.id}`,
                createdBy: req.user!.id,
              },
            });
          }
        }

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: canApproveImmediately
            ? 'RECONCILIATION_APPROVED'
            : 'RECONCILIATION_SUBMITTED',
          entityType: 'Reconciliation',
          entityId: created.id,
          beforeState: { calculatedStock },
          afterState: { physicalStock, variance, status: created.status },
          remarks: parsed.remarks,
        });

        return created;
      });

      await refreshCentreAlerts(centreId);
      res.status(201).json({ success: true, data: reconciliation });
    } catch (err) {
      next(err);
    }
  }
);

