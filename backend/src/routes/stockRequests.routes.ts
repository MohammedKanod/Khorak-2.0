import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  Prisma,
  Role,
  StockRequestReason,
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
import { recordAuditLog } from '../lib/audit';
import { roundQty } from '../lib/math';
import { getCentreInventorySummary } from '../services/ledger.service';

export const stockRequestsRouter = Router();

stockRequestsRouter.use(requireAuth);

const MAX_AUTHORISED_REQUEST_QTY = 5000;

const createStockRequestSchema = z.object({
  centreId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  requestedQuantity: z.coerce.number().positive().max(MAX_AUTHORISED_REQUEST_QTY),
  reason: z.enum(['LOW_STOCK', 'EXPECTED_DEMAND', 'DAMAGED_STOCK', 'OTHER']),
  remarks: z.string().max(400).trim().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export async function executeCreateStockRequest(params: {
  userId: string;
  centreId: string;
  productId: string;
  requestedQuantity: number;
  reason: StockRequestReason;
  remarks?: string;
  idempotencyKey: string;
}) {
  const existing = await prisma.stockRequest.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    include: {
      centre: { select: { id: true, name: true, nameGu: true, code: true } },
      product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
    },
  });
  if (existing) {
    return { request: existing, deduplicated: true };
  }

  const [centre, product] = await Promise.all([
    prisma.anganwadiCentre.findUnique({ where: { id: params.centreId } }),
    prisma.product.findUnique({ where: { id: params.productId } }),
  ]);
  if (!centre || !centre.isActive) {
    throw new AppError(404, 'CENTRE_NOT_FOUND', 'Anganwadi Centre not found');
  }
  if (!product || !product.isActive) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  const requestNumber = `REQ-${centre.code}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.stockRequest.create({
      data: {
        requestNumber,
        centreId: params.centreId,
        productId: params.productId,
        requestedQuantity: roundQty(params.requestedQuantity),
        reason: params.reason,
        remarks: params.remarks || null,
        status: StockRequestStatus.PENDING_APPROVAL,
        requestedBy: params.userId,
        idempotencyKey: params.idempotencyKey,
        history: {
          create: {
            actorId: params.userId,
            fromStatus: null,
            toStatus: StockRequestStatus.PENDING_APPROVAL,
            action: 'SUBMITTED',
            remarks: params.remarks || `Requested ${params.requestedQuantity} ${product.unit} (${params.reason})`,
          },
        },
      },
      include: {
        centre: { select: { id: true, name: true, nameGu: true, code: true } },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        requester: { select: { id: true, name: true, role: true } },
        history: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await recordAuditLog(tx, {
      actorId: params.userId,
      action: 'STOCK_REQUEST_CREATED',
      entityType: 'StockRequest',
      entityId: row.id,
      afterState: {
        requestNumber: row.requestNumber,
        productId: row.productId,
        requestedQuantity: row.requestedQuantity,
        status: row.status,
      },
      remarks: params.remarks,
    });

    return row;
  });

  return { request: created, deduplicated: false };
}

stockRequestsRouter.post(
  '/',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const parsed = createStockRequestSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const idempotencyKey = parsed.idempotencyKey || `sreq-${crypto.randomUUID()}`;

      const result = await executeCreateStockRequest({
        userId: req.user!.id,
        centreId,
        productId: parsed.productId,
        requestedQuantity: parsed.requestedQuantity,
        reason: parsed.reason as StockRequestReason,
        remarks: parsed.remarks,
        idempotencyKey,
      });

      res.status(result.deduplicated ? 200 : 201).json({
        success: true,
        data: result.request,
        deduplicated: result.deduplicated,
      });
    } catch (err) {
      next(err);
    }
  }
);

stockRequestsRouter.get('/', async (req, res, next) => {
  try {
    let where: Prisma.StockRequestWhereInput = {};
    if (req.user!.role === Role.SUPPLIER) {
      // Suppliers see approved requests ready for dispatch or already dispatched by them
      where = {
        OR: [
          {
            status: {
              in: [
                StockRequestStatus.APPROVED,
                StockRequestStatus.PARTIALLY_APPROVED,
                StockRequestStatus.AWAITING_DISPATCH,
              ],
            },
          },
          {
            dispatches: {
              some: { supplierId: req.user!.supplierId ?? '__none__' },
            },
          },
        ],
      };
    } else {
      where = { centre: buildCentreScopeWhere(req.user!) };
    }

    const requests = await prisma.stockRequest.findMany({
      where,
      include: {
        centre: {
          select: {
            id: true,
            name: true,
            nameGu: true,
            code: true,
            sector: { select: { name: true, block: { select: { name: true } } } },
          },
        },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        requester: { select: { id: true, name: true, role: true } },
        reviewer: { select: { id: true, name: true, role: true } },
        dispatches: {
          select: { id: true, dispatchReference: true, status: true, supplierId: true },
          orderBy: { createdAt: 'desc' },
        },
        history: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });

    res.json({ success: true, data: requests });
  } catch (err) {
    next(err);
  }
});

stockRequestsRouter.get('/:id', async (req, res, next) => {
  try {
    const reqRow = await prisma.stockRequest.findUnique({
      where: { id: String(req.params.id) },
      include: {
        centre: { include: { sector: { include: { block: true } } } },
        product: true,
        requester: { select: { id: true, name: true, role: true } },
        reviewer: { select: { id: true, name: true, role: true } },
        dispatches: true,
        history: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!reqRow) throw new AppError(404, 'NOT_FOUND', 'Stock request not found');

    if (req.user!.role === Role.SUPPLIER) {
      const canView =
        (
          [
            StockRequestStatus.APPROVED,
            StockRequestStatus.PARTIALLY_APPROVED,
            StockRequestStatus.AWAITING_DISPATCH,
          ] as StockRequestStatus[]
        ).includes(reqRow.status) ||
        reqRow.dispatches.some((d) => d.supplierId === req.user!.supplierId);
      if (!canView) {
        throw new AppError(403, 'FORBIDDEN', 'Stock request is not authorised for supplier view');
      }
    } else {
      await assertCentreInScope(req.user!, reqRow.centreId);
    }

    const summary = await getCentreInventorySummary(reqRow.centreId);
    const productStock = summary.find((p) => p.productId === reqRow.productId) || null;

    res.json({ success: true, data: { ...reqRow, currentCentreProductStock: productStock } });
  } catch (err) {
    next(err);
  }
});

const reviewStockRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'PARTIAL_APPROVE', 'REJECT']),
  approvedQuantity: z.coerce.number().positive().max(MAX_AUTHORISED_REQUEST_QTY).optional(),
  remarks: z.string().min(3, 'Remarks are mandatory').max(500).trim(),
});

stockRequestsRouter.post(
  '/:id/review',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = reviewStockRequestSchema.parse(req.body);
      const existing = await prisma.stockRequest.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Stock request not found');

      // AWW or original requester cannot approve their own request
      if (existing.requestedBy === req.user!.id) {
        throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'Requester cannot approve their own stock request');
      }

      await assertCentreInScope(req.user!, existing.centreId);

      if (
        existing.status !== StockRequestStatus.PENDING_APPROVAL &&
        existing.status !== StockRequestStatus.SUBMITTED
      ) {
        throw new AppError(
          400,
          'ALREADY_REVIEWED',
          `Stock request in status ${existing.status} cannot be reviewed again`
        );
      }

      let nextStatus: StockRequestStatus;
      let approvedQty: number | null = null;

      if (parsed.decision === 'REJECT') {
        nextStatus = StockRequestStatus.REJECTED;
      } else if (parsed.decision === 'APPROVE') {
        approvedQty = roundQty(parsed.approvedQuantity ?? existing.requestedQuantity);
        if (approvedQty > existing.requestedQuantity) {
          throw new AppError(
            400,
            'EXCEEDS_REQUESTED_QTY',
            `Approved quantity (${approvedQty}) cannot exceed requested quantity (${existing.requestedQuantity})`
          );
        }
        nextStatus =
          approvedQty < existing.requestedQuantity
            ? StockRequestStatus.PARTIALLY_APPROVED
            : StockRequestStatus.APPROVED;
      } else {
        if (parsed.approvedQuantity === undefined) {
          throw new AppError(400, 'APPROVED_QTY_REQUIRED', 'approvedQuantity is required for partial approval');
        }
        approvedQty = roundQty(parsed.approvedQuantity);
        if (approvedQty <= 0 || approvedQty >= existing.requestedQuantity) {
          throw new AppError(
            400,
            'INVALID_PARTIAL_QTY',
            `Partial approval quantity must be between 0 and ${existing.requestedQuantity}`
          );
        }
        nextStatus = StockRequestStatus.PARTIALLY_APPROVED;
      }

      // IMPORTANT: Approving a stock request never increases stock directly;
      // stock only increases when the supplier dispatches and the AWW receives delivery.
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.stockRequest.update({
          where: { id: existing.id },
          data: {
            status: nextStatus,
            approvedQuantity: approvedQty,
            reviewedBy: req.user!.id,
            reviewRemarks: parsed.remarks,
            reviewedAt: new Date(),
            history: {
              create: {
                actorId: req.user!.id,
                fromStatus: existing.status,
                toStatus: nextStatus,
                action: parsed.decision,
                remarks: parsed.remarks,
              },
            },
          },
          include: {
            centre: { select: { id: true, name: true, code: true } },
            product: { select: { id: true, name: true, unit: true } },
            history: {
              include: { actor: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: `STOCK_REQUEST_${parsed.decision}`,
          entityType: 'StockRequest',
          entityId: existing.id,
          beforeState: { status: existing.status },
          afterState: { status: nextStatus, approvedQuantity: approvedQty },
          remarks: parsed.remarks,
        });

        return row;
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

