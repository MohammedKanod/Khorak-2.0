import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  BatchStatus,
  DiscrepancyStatus,
  DispatchStatus,
  LedgerEventType,
  Prisma,
  Role,
  StockRequestStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCentreInScope,
  buildCentreScopeWhere,
  requireAuth,
  requireRoles,
} from '../middleware/auth';
import { evidenceUpload } from '../middleware/upload';
import { recordAuditLog } from '../lib/audit';
import { refreshCentreAlerts } from '../services/alert.service';
import { acquireStockLock } from '../services/ledger.service';
import { roundQty } from '../lib/math';

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth);

dispatchRouter.get(
  '/targets',
  requireRoles(Role.SUPPLIER, Role.CDPO, Role.SUPERVISOR, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const centreFilter: Prisma.AnganwadiCentreWhereInput =
        req.user!.role === Role.SUPPLIER
          ? { isActive: true }
          : { ...buildCentreScopeWhere(req.user!), isActive: true };

      const [centres, products, suppliers] = await Promise.all([
        prisma.anganwadiCentre.findMany({
          where: centreFilter,
          include: {
            sector: { include: { block: { select: { id: true, name: true } } } },
          },
          orderBy: { name: 'asc' },
        }),
        prisma.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.supplier.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
      ]);

      res.json({ success: true, data: { centres, products, suppliers } });
    } catch (err) {
      next(err);
    }
  }
);

const dispatchItemInputSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().min(2).max(60).trim(),
  manufacturingDate: z.string().optional(),
  expiryDate: z.string().min(8),
  expectedQuantity: z.coerce.number().positive(),
});

const createDispatchSchema = z.object({
  supplierId: z.string().uuid().optional(),
  destinationCentreId: z.string().uuid(),
  stockRequestId: z.string().uuid().optional(),
  dispatchDate: z.string().optional(),
  status: z.enum(['DRAFT', 'DISPATCHED']).default('DISPATCHED'),
  notes: z.string().max(400).optional(),
  items: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, z.array(dispatchItemInputSchema).min(1)),
});

dispatchRouter.post(
  '/',
  requireRoles(Role.SUPPLIER, Role.CDPO),
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const parsed = createDispatchSchema.parse(req.body);

      if (
        req.user!.role === Role.SUPPLIER &&
        parsed.supplierId &&
        parsed.supplierId !== req.user!.supplierId
      ) {
        throw new AppError(
          403,
          'SUPPLIER_OWNERSHIP_FORBIDDEN',
          'Supplier cannot create dispatches on behalf of another supplier'
        );
      }

      const supplierId =
        req.user!.role === Role.SUPPLIER
          ? req.user!.supplierId
          : parsed.supplierId;

      if (!supplierId) {
        throw new AppError(400, 'SUPPLIER_REQUIRED', 'Supplier ID is required');
      }

      const [supplier, centre] = await Promise.all([
        prisma.supplier.findUnique({ where: { id: supplierId } }),
        prisma.anganwadiCentre.findUnique({ where: { id: parsed.destinationCentreId } }),
      ]);

      if (!supplier) {
        throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
      }
      if (!centre) {
        throw new AppError(404, 'CENTRE_NOT_FOUND', 'Destination Anganwadi Centre not found');
      }

      if (parsed.stockRequestId) {
        const stockReq = await prisma.stockRequest.findUnique({
          where: { id: parsed.stockRequestId },
        });
        if (!stockReq || stockReq.centreId !== parsed.destinationCentreId) {
          throw new AppError(
            400,
            'INVALID_STOCK_REQUEST',
            'Stock request does not match the destination centre'
          );
        }
        const dispatchableStatuses: StockRequestStatus[] = [
          StockRequestStatus.APPROVED,
          StockRequestStatus.PARTIALLY_APPROVED,
          StockRequestStatus.AWAITING_DISPATCH,
        ];
        if (!dispatchableStatuses.includes(stockReq.status)) {
          throw new AppError(
            400,
            'STOCK_REQUEST_NOT_APPROVED',
            `Stock request in status ${stockReq.status} cannot be dispatched`
          );
        }
      }

      const productIds = Array.from(new Set(parsed.items.map((i) => i.productId)));
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });
      if (products.length !== productIds.length) {
        throw new AppError(400, 'INVALID_PRODUCT', 'One or more selected products are invalid');
      }

      const evidenceUrl = req.file ? `/uploads/${req.file.filename}` : null;
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const dispatchReference = `DSP-${centre.code}-${dateCode}-${suffix}`;

      const dispatch = await prisma.$transaction(async (tx) => {
        const resolvedItems: Array<{
          productId: string;
          batchId: string;
          expectedQuantity: number;
        }> = [];

        for (const item of parsed.items) {
          const expiryDate = new Date(item.expiryDate);
          if (Number.isNaN(expiryDate.getTime())) {
            throw new AppError(400, 'INVALID_DATE', `Invalid expiryDate for batch ${item.batchNumber}`);
          }
          const mfgDate = item.manufacturingDate ? new Date(item.manufacturingDate) : null;

          const batch = await tx.productBatch.upsert({
            where: {
              productId_batchNumber_supplierId: {
                productId: item.productId,
                batchNumber: item.batchNumber,
                supplierId,
              },
            },
            update: {},
            create: {
              productId: item.productId,
              batchNumber: item.batchNumber,
              supplierId,
              manufacturingDate: mfgDate,
              expiryDate,
              status: expiryDate <= new Date() ? BatchStatus.EXPIRED : BatchStatus.ACTIVE,
            },
          });

          resolvedItems.push({
            productId: item.productId,
            batchId: batch.id,
            expectedQuantity: roundQty(item.expectedQuantity),
          });
        }

        const created = await tx.dispatch.create({
          data: {
            supplierId,
            destinationCentreId: parsed.destinationCentreId,
            stockRequestId: parsed.stockRequestId ?? null,
            dispatchReference,
            status: parsed.status as DispatchStatus,
            dispatchDate: parsed.dispatchDate ? new Date(parsed.dispatchDate) : new Date(),
            evidenceUrl,
            notes: parsed.notes,
            createdBy: req.user!.id,
            items: {
              create: resolvedItems,
            },
          },
          include: {
            supplier: true,
            destinationCentre: {
              include: { sector: { include: { block: true } } },
            },
            items: {
              include: { product: true, batch: true },
            },
          },
        });

        if (parsed.stockRequestId && parsed.status === 'DISPATCHED') {
          const prevReq = await tx.stockRequest.findUnique({
            where: { id: parsed.stockRequestId },
          });
          if (prevReq) {
            await tx.stockRequest.update({
              where: { id: parsed.stockRequestId },
              data: {
                status: StockRequestStatus.DISPATCHED,
                history: {
                  create: {
                    actorId: req.user!.id,
                    fromStatus: prevReq.status,
                    toStatus: StockRequestStatus.DISPATCHED,
                    action: 'DISPATCH_CREATED',
                    remarks: `Linked to dispatch ${created.dispatchReference}`,
                  },
                },
              },
            });
          }
        }

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'DISPATCH_CREATED',
          entityType: 'Dispatch',
          entityId: created.id,
          afterState: {
            dispatchReference: created.dispatchReference,
            destinationCentreId: created.destinationCentreId,
            status: created.status,
            itemCount: created.items.length,
          },
          remarks: parsed.notes,
        });

        return created;
      });

      await refreshCentreAlerts(parsed.destinationCentreId);
      res.status(201).json({ success: true, data: dispatch });
    } catch (err) {
      next(err);
    }
  }
);

dispatchRouter.get('/', async (req, res, next) => {
  try {
    const statusFilter =
      typeof req.query.status === 'string' &&
      ['DRAFT', 'DISPATCHED', 'DELIVERED', 'DISCREPANCY', 'CANCELLED'].includes(req.query.status)
        ? (req.query.status as DispatchStatus)
        : undefined;

    let where: Prisma.DispatchWhereInput = {};
    if (req.user!.role === Role.SUPPLIER) {
      where = { supplierId: req.user!.supplierId ?? '__none__' };
    } else {
      where = { destinationCentre: buildCentreScopeWhere(req.user!) };
    }

    if (statusFilter) {
      where.status = statusFilter;
    }

    const dispatches = await prisma.dispatch.findMany({
      where,
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
    });

    res.json({ success: true, data: dispatches });
  } catch (err) {
    next(err);
  }
});

dispatchRouter.get('/:id', async (req, res, next) => {
  try {
    const dispatch = await prisma.dispatch.findUnique({
      where: { id: String(req.params.id) },
      include: {
        supplier: true,
        destinationCentre: { include: { sector: { include: { block: true } } } },
        items: { include: { product: true, batch: true } },
        deliveryReceipt: {
          include: {
            items: { include: { product: true, batch: true } },
            receiver: { select: { id: true, name: true, role: true } },
          },
        },
        discrepancyCases: true,
      },
    });

    if (!dispatch) {
      throw new AppError(404, 'NOT_FOUND', 'Dispatch not found');
    }

    if (req.user!.role === Role.SUPPLIER) {
      if (dispatch.supplierId !== req.user!.supplierId) {
        throw new AppError(403, 'SCOPE_FORBIDDEN', 'Dispatch belongs to another supplier');
      }
    } else {
      await assertCentreInScope(req.user!, dispatch.destinationCentreId);
    }

    res.json({ success: true, data: dispatch });
  } catch (err) {
    next(err);
  }
});

dispatchRouter.post(
  '/:id/submit',
  requireRoles(Role.SUPPLIER, Role.CDPO),
  async (req, res, next) => {
    try {
      const dispatch = await prisma.dispatch.findUnique({ where: { id: String(req.params.id) } });
      if (!dispatch) throw new AppError(404, 'NOT_FOUND', 'Dispatch not found');

      if (req.user!.role === Role.SUPPLIER && dispatch.supplierId !== req.user!.supplierId) {
        throw new AppError(403, 'SCOPE_FORBIDDEN', 'Not authorised for this dispatch');
      }

      if (dispatch.status !== DispatchStatus.DRAFT) {
        throw new AppError(400, 'INVALID_STATE', 'Only draft dispatches can be submitted');
      }

      const updated = await prisma.dispatch.update({
        where: { id: dispatch.id },
        data: { status: DispatchStatus.DISPATCHED },
      });

      await refreshCentreAlerts(dispatch.destinationCentreId);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

const receiptItemSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  acceptedQuantity: z.coerce.number().min(0),
  damagedQuantity: z.coerce.number().min(0).default(0),
  missingQuantity: z.coerce.number().min(0).optional(),
});

const receiveDispatchSchema = z.object({
  idempotencyKey: z.string().min(8).max(120).optional(),
  notes: z.string().max(400).optional(),
  items: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, z.array(receiptItemSchema).min(1)),
});

dispatchRouter.post(
  '/:id/receipt',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const parsed = receiveDispatchSchema.parse(req.body);
      const dispatchId = String(req.params.id);
      const idempotencyKey = parsed.idempotencyKey || `dlv-${dispatchId}`;

      const existingReceipt = await prisma.deliveryReceipt.findUnique({
        where: { idempotencyKey },
        include: { items: true, discrepancyCase: true },
      });
      if (existingReceipt) {
        return res.json({ success: true, data: existingReceipt, deduplicated: true });
      }

      const dispatch = await prisma.dispatch.findUnique({
        where: { id: dispatchId },
        include: {
          items: true,
          deliveryReceipt: true,
        },
      });

      if (!dispatch) {
        throw new AppError(404, 'NOT_FOUND', 'Dispatch not found');
      }

      await assertCentreInScope(req.user!, dispatch.destinationCentreId);

      if (dispatch.deliveryReceipt) {
        throw new AppError(409, 'ALREADY_RECEIVED', 'Delivery receipt already recorded for this dispatch');
      }
      if (dispatch.status !== DispatchStatus.DISPATCHED) {
        throw new AppError(
          400,
          'INVALID_DISPATCH_STATUS',
          `Cannot receive dispatch in status ${dispatch.status}`
        );
      }

      const evidenceUrl = req.file ? `/uploads/${req.file.filename}` : null;

      let totalExpected = 0;
      let totalAccepted = 0;
      let totalDamaged = 0;
      let totalMissing = 0;

      const receiptItemsData: Array<{
        productId: string;
        batchId: string;
        expectedQuantity: number;
        acceptedQuantity: number;
        damagedQuantity: number;
        missingQuantity: number;
      }> = [];

      // Validate strict 1-to-1 line matching: reject extra, duplicate, or unknown product/batch lines
      const seenKeys = new Set<string>();
      for (const item of parsed.items) {
        const key = `${item.productId}:${item.batchId}`;
        if (seenKeys.has(key)) {
          throw new AppError(400, 'DUPLICATE_RECEIPT_LINE', 'Duplicate product/batch line in receipt');
        }
        seenKeys.add(key);
        const existsOnDispatch = dispatch.items.some(
          (d) => d.productId === item.productId && d.batchId === item.batchId
        );
        if (!existsOnDispatch) {
          throw new AppError(
            400,
            'INVALID_RECEIPT_LINE',
            'Receipt line product or batch does not match this dispatch'
          );
        }
      }

      if (parsed.items.length !== dispatch.items.length) {
        throw new AppError(
          400,
          'MISSING_ITEM_RECEIPT',
          'Receipt must include every line item from the dispatch'
        );
      }

      for (const dItem of dispatch.items) {
        const matched = parsed.items.find(
          (i) => i.productId === dItem.productId && i.batchId === dItem.batchId
        );
        if (!matched) {
          throw new AppError(
            400,
            'MISSING_ITEM_RECEIPT',
            'Receipt quantities must be provided for every dispatched item'
          );
        }

        const expected = roundQty(dItem.expectedQuantity);
        const accepted = roundQty(matched.acceptedQuantity);
        const damaged = roundQty(matched.damagedQuantity ?? 0);
        const computedMissing =
          matched.missingQuantity !== undefined
            ? roundQty(matched.missingQuantity)
            : roundQty(Math.max(0, expected - accepted - damaged));

        if (accepted < 0 || damaged < 0 || computedMissing < 0) {
          throw new AppError(400, 'INVALID_QUANTITY', 'Quantities cannot be negative');
        }

        if (roundQty(accepted + damaged + computedMissing) !== expected) {
          throw new AppError(
            400,
            'QUANTITY_MISMATCH',
            `Accepted (${accepted}) + Damaged (${damaged}) + Missing (${computedMissing}) must equal Expected (${expected})`
          );
        }

        totalExpected = roundQty(totalExpected + expected);
        totalAccepted = roundQty(totalAccepted + accepted);
        totalDamaged = roundQty(totalDamaged + damaged);
        totalMissing = roundQty(totalMissing + computedMissing);

        receiptItemsData.push({
          productId: dItem.productId,
          batchId: dItem.batchId,
          expectedQuantity: expected,
          acceptedQuantity: accepted,
          damagedQuantity: damaged,
          missingQuantity: computedMissing,
        });
      }

      const hasDiscrepancy = totalAccepted !== totalExpected;

      const result = await prisma.$transaction(async (tx) => {
        const receipt = await tx.deliveryReceipt.create({
          data: {
            dispatchId: dispatch.id,
            expectedQuantity: totalExpected,
            acceptedQuantity: totalAccepted,
            damagedQuantity: totalDamaged,
            missingQuantity: totalMissing,
            evidenceUrl,
            notes: parsed.notes,
            receivedBy: req.user!.id,
            idempotencyKey,
            items: {
              create: receiptItemsData,
            },
          },
          include: {
            items: { include: { product: true, batch: true } },
          },
        });

        for (let idx = 0; idx < receiptItemsData.length; idx++) {
          const item = receiptItemsData[idx];
          if (item.acceptedQuantity > 0) {
            await acquireStockLock(tx, dispatch.destinationCentreId, item.productId);
            await tx.stockLedgerEvent.create({
              data: {
                centreId: dispatch.destinationCentreId,
                productId: item.productId,
                batchId: item.batchId,
                eventType: LedgerEventType.RECEIVED,
                quantity: item.acceptedQuantity,
                referenceId: receipt.id,
                referenceType: 'DELIVERY_RECEIPT',
                remarks: `Received under dispatch ${dispatch.dispatchReference}`,
                idempotencyKey: `dlv-led-${receipt.id}-${idx}`,
                createdBy: req.user!.id,
              },
            });
          }
        }

        let discrepancyCase = null;
        if (hasDiscrepancy) {
          discrepancyCase = await tx.discrepancyCase.create({
            data: {
              dispatchId: dispatch.id,
              deliveryReceiptId: receipt.id,
              expectedQuantity: totalExpected,
              actualQuantity: totalAccepted,
              damagedQuantity: totalDamaged,
              missingQuantity: totalMissing,
              difference: roundQty(totalExpected - totalAccepted),
              status: DiscrepancyStatus.OPEN,
            },
          });
        }

        await tx.dispatch.update({
          where: { id: dispatch.id },
          data: {
            status: hasDiscrepancy ? DispatchStatus.DISCREPANCY : DispatchStatus.DELIVERED,
          },
        });

        if (dispatch.stockRequestId) {
          const linkedReq = await tx.stockRequest.findUnique({
            where: { id: dispatch.stockRequestId },
          });
          if (linkedReq) {
            const targetReqStatus = hasDiscrepancy
              ? StockRequestStatus.RECEIVED
              : StockRequestStatus.COMPLETED;
            await tx.stockRequest.update({
              where: { id: linkedReq.id },
              data: {
                status: targetReqStatus,
                history: {
                  create: {
                    actorId: req.user!.id,
                    fromStatus: linkedReq.status,
                    toStatus: targetReqStatus,
                    action: 'DELIVERY_RECEIVED',
                    remarks: `Received ${totalAccepted}/${totalExpected} under ${dispatch.dispatchReference}`,
                  },
                },
              },
            });
          }
        }

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: hasDiscrepancy ? 'DELIVERY_RECEIVED_WITH_DISCREPANCY' : 'DELIVERY_RECEIVED',
          entityType: 'DeliveryReceipt',
          entityId: receipt.id,
          afterState: {
            expectedQuantity: totalExpected,
            acceptedQuantity: totalAccepted,
            damagedQuantity: totalDamaged,
            missingQuantity: totalMissing,
            discrepancyId: discrepancyCase?.id ?? null,
          },
          remarks: parsed.notes,
        });

        return { receipt, discrepancyCase };
      });

      await refreshCentreAlerts(dispatch.destinationCentreId);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

dispatchRouter.get('/:id/discrepancies', async (req, res, next) => {
  try {
    const dispatch = await prisma.dispatch.findUnique({ where: { id: String(req.params.id) } });
    if (!dispatch) throw new AppError(404, 'NOT_FOUND', 'Dispatch not found');

    if (req.user!.role === Role.SUPPLIER) {
      if (dispatch.supplierId !== req.user!.supplierId) {
        throw new AppError(403, 'SCOPE_FORBIDDEN', 'Not authorised');
      }
    } else {
      await assertCentreInScope(req.user!, dispatch.destinationCentreId);
    }

    const cases = await prisma.discrepancyCase.findMany({
      where: { dispatchId: dispatch.id },
      include: {
        resolver: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
});

