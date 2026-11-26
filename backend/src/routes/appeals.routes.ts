import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { AppealStatus, Prisma, Role } from '@prisma/client';
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

export const appealsRouter = Router();

appealsRouter.use(requireAuth);

const createAppealSchema = z.object({
  discrepancyCaseId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  supervisorRemarks: z.string().min(5, 'Supervisor remarks are required').max(600).trim(),
  submitImmediately: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .default(true),
});

appealsRouter.post(
  '/',
  requireRoles(Role.SUPERVISOR, Role.CDPO),
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const parsed = createAppealSchema.parse(req.body);

      const discrepancy = await prisma.discrepancyCase.findUnique({
        where: { id: parsed.discrepancyCaseId },
        include: {
          dispatch: {
            include: {
              items: true,
              destinationCentre: { select: { id: true, code: true, name: true } },
            },
          },
        },
      });

      if (!discrepancy) {
        throw new AppError(404, 'DISCREPANCY_NOT_FOUND', 'Discrepancy case not found');
      }

      await assertCentreInScope(req.user!, discrepancy.dispatch.destinationCentreId);

      const primaryItem = discrepancy.dispatch.items[0];
      const productId = parsed.productId || primaryItem?.productId || null;
      const batchId = parsed.batchId || primaryItem?.batchId || null;

      if (parsed.productId || parsed.batchId) {
        const matchesLine = discrepancy.dispatch.items.some(
          (i) =>
            (!parsed.productId || i.productId === parsed.productId) &&
            (!parsed.batchId || i.batchId === parsed.batchId)
        );
        if (!matchesLine) {
          throw new AppError(
            400,
            'INVALID_DISPATCH_LINE',
            'Product or batch does not belong to the referenced dispatch'
          );
        }
      }

      const initialStatus = parsed.submitImmediately
        ? AppealStatus.AWAITING_SUPPLIER_RESPONSE
        : AppealStatus.DRAFT;

      const appealReference = `APL-${discrepancy.dispatch.destinationCentre.code}-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;

      const evidenceUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const created = await prisma.$transaction(async (tx) => {
        const appeal = await tx.dispatchAppeal.create({
          data: {
            appealReference,
            discrepancyCaseId: discrepancy.id,
            dispatchId: discrepancy.dispatchId,
            supplierId: discrepancy.dispatch.supplierId,
            centreId: discrepancy.dispatch.destinationCentreId,
            productId,
            batchId,
            dispatchedQuantity: discrepancy.expectedQuantity,
            receivedQuantity: discrepancy.actualQuantity,
            damagedQuantity: discrepancy.damagedQuantity,
            missingQuantity: discrepancy.missingQuantity,
            evidenceUrl,
            supervisorRemarks: parsed.supervisorRemarks,
            status: initialStatus,
            createdBy: req.user!.id,
            history: {
              create: {
                actorId: req.user!.id,
                fromStatus: null,
                toStatus: initialStatus,
                action: parsed.submitImmediately ? 'SUBMITTED_TO_SUPPLIER' : 'DRAFT_CREATED',
                remarks: parsed.supervisorRemarks,
                evidenceUrl,
              },
            },
          },
          include: {
            dispatch: { select: { id: true, dispatchReference: true } },
            supplier: { select: { id: true, name: true, code: true } },
            centre: { select: { id: true, name: true, nameGu: true, code: true } },
            product: { select: { id: true, name: true, nameGu: true, unit: true } },
            batch: { select: { id: true, batchNumber: true } },
            history: {
              include: { actor: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'DISPATCH_APPEAL_CREATED',
          entityType: 'DispatchAppeal',
          entityId: appeal.id,
          afterState: {
            appealReference: appeal.appealReference,
            status: appeal.status,
            supplierId: appeal.supplierId,
          },
          remarks: parsed.supervisorRemarks,
        });

        return appeal;
      });

      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

appealsRouter.get('/', async (req, res, next) => {
  try {
    if (req.user!.role === Role.AWW || req.user!.role === Role.AWH) {
      throw new AppError(403, 'FORBIDDEN', 'Centre workers cannot access supplier appeals');
    }

    const where: Prisma.DispatchAppealWhereInput =
      req.user!.role === Role.SUPPLIER
        ? {
            supplierId: req.user!.supplierId ?? '__none__',
            status: { not: AppealStatus.DRAFT },
          }
        : { centre: buildCentreScopeWhere(req.user!) };

    const appeals = await prisma.dispatchAppeal.findMany({
      where,
      include: {
        dispatch: { select: { id: true, dispatchReference: true, dispatchDate: true } },
        discrepancyCase: { select: { id: true, difference: true, status: true } },
        supplier: { select: { id: true, name: true, code: true } },
        centre: { select: { id: true, name: true, nameGu: true, code: true } },
        product: { select: { id: true, name: true, nameGu: true, unit: true } },
        batch: { select: { id: true, batchNumber: true } },
        creator: { select: { id: true, name: true, role: true } },
        responder: { select: { id: true, name: true, role: true } },
        resolver: { select: { id: true, name: true, role: true } },
        history: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 150,
    });

    res.json({ success: true, data: appeals });
  } catch (err) {
    next(err);
  }
});

appealsRouter.get('/:id', async (req, res, next) => {
  try {
    const appeal = await prisma.dispatchAppeal.findUnique({
      where: { id: String(req.params.id) },
      include: {
        dispatch: true,
        discrepancyCase: true,
        supplier: true,
        centre: { include: { sector: { include: { block: true } } } },
        product: true,
        batch: true,
        history: {
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!appeal) throw new AppError(404, 'NOT_FOUND', 'Dispatch appeal not found');

    if (req.user!.role === Role.SUPPLIER) {
      if (appeal.supplierId !== req.user!.supplierId || appeal.status === AppealStatus.DRAFT) {
        throw new AppError(403, 'SCOPE_FORBIDDEN', 'Appeal is outside your supplier scope');
      }
    } else if (req.user!.role === Role.AWW || req.user!.role === Role.AWH) {
      throw new AppError(403, 'FORBIDDEN', 'Centre workers cannot access supplier appeals');
    } else {
      await assertCentreInScope(req.user!, appeal.centreId);
    }

    res.json({ success: true, data: appeal });
  } catch (err) {
    next(err);
  }
});

appealsRouter.post(
  '/:id/submit',
  requireRoles(Role.SUPERVISOR, Role.CDPO),
  async (req, res, next) => {
    try {
      const appeal = await prisma.dispatchAppeal.findUnique({ where: { id: String(req.params.id) } });
      if (!appeal) throw new AppError(404, 'NOT_FOUND', 'Appeal not found');
      await assertCentreInScope(req.user!, appeal.centreId);

      if (appeal.status !== AppealStatus.DRAFT && appeal.status !== AppealStatus.SUBMITTED) {
        throw new AppError(400, 'INVALID_STATUS', 'Only draft or submitted appeals can be dispatched to supplier');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispatchAppeal.update({
          where: { id: appeal.id },
          data: {
            status: AppealStatus.AWAITING_SUPPLIER_RESPONSE,
            history: {
              create: {
                actorId: req.user!.id,
                fromStatus: appeal.status,
                toStatus: AppealStatus.AWAITING_SUPPLIER_RESPONSE,
                action: 'SENT_TO_SUPPLIER',
                remarks: 'Submitted to supplier for formal response',
              },
            },
          },
        });
        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'DISPATCH_APPEAL_SUBMITTED',
          entityType: 'DispatchAppeal',
          entityId: appeal.id,
          beforeState: { status: appeal.status },
          afterState: { status: row.status },
        });
        return row;
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

appealsRouter.post(
  '/:id/respond',
  requireRoles(Role.SUPPLIER),
  evidenceUpload.single('evidence'),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          supplierRemarks: z.string().min(5, 'Response remarks are required').max(600).trim(),
        })
        .parse(req.body);

      const appeal = await prisma.dispatchAppeal.findUnique({ where: { id: String(req.params.id) } });
      if (!appeal) throw new AppError(404, 'NOT_FOUND', 'Appeal not found');

      // Strict backend supplier ownership enforcement
      if (appeal.supplierId !== req.user!.supplierId) {
        throw new AppError(403, 'SUPPLIER_OWNERSHIP_FORBIDDEN', 'You can only respond to appeals on your own dispatches');
      }

      if (
        appeal.status !== AppealStatus.AWAITING_SUPPLIER_RESPONSE &&
        appeal.status !== AppealStatus.SUBMITTED
      ) {
        throw new AppError(
          400,
          'INVALID_APPEAL_STATUS',
          `Cannot respond to appeal in status ${appeal.status}`
        );
      }

      const supplierEvidenceUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispatchAppeal.update({
          where: { id: appeal.id },
          data: {
            supplierRemarks: parsed.supplierRemarks,
            ...(supplierEvidenceUrl ? { supplierEvidenceUrl } : {}),
            respondedBy: req.user!.id,
            respondedAt: new Date(),
            status: AppealStatus.SUPPLIER_RESPONDED,
            history: {
              create: {
                actorId: req.user!.id,
                fromStatus: appeal.status,
                toStatus: AppealStatus.SUPPLIER_RESPONDED,
                action: 'SUPPLIER_RESPONDED',
                remarks: parsed.supplierRemarks,
                evidenceUrl: supplierEvidenceUrl,
              },
            },
          },
          include: {
            history: {
              include: { actor: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'DISPATCH_APPEAL_SUPPLIER_RESPONDED',
          entityType: 'DispatchAppeal',
          entityId: appeal.id,
          beforeState: { status: appeal.status },
          afterState: { status: row.status },
          remarks: parsed.supplierRemarks,
        });

        return row;
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

appealsRouter.post(
  '/:id/review',
  requireRoles(Role.SUPERVISOR, Role.CDPO),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          decision: z.enum(['UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED']),
          remarks: z.string().min(3, 'Remarks are mandatory').max(600).trim(),
        })
        .parse(req.body);

      const appeal = await prisma.dispatchAppeal.findUnique({ where: { id: String(req.params.id) } });
      if (!appeal) throw new AppError(404, 'NOT_FOUND', 'Appeal not found');
      await assertCentreInScope(req.user!, appeal.centreId);

      const targetStatus = parsed.decision as AppealStatus;
      const isFinal =
        targetStatus === AppealStatus.RESOLVED ||
        targetStatus === AppealStatus.REJECTED ||
        targetStatus === AppealStatus.ESCALATED;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispatchAppeal.update({
          where: { id: appeal.id },
          data: {
            status: targetStatus,
            resolutionRemarks: parsed.remarks,
            ...(isFinal ? { resolvedBy: req.user!.id, resolvedAt: new Date() } : {}),
            history: {
              create: {
                actorId: req.user!.id,
                fromStatus: appeal.status,
                toStatus: targetStatus,
                action: `SUPERVISOR_${parsed.decision}`,
                remarks: parsed.remarks,
              },
            },
          },
          include: {
            history: {
              include: { actor: { select: { id: true, name: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: `DISPATCH_APPEAL_${parsed.decision}`,
          entityType: 'DispatchAppeal',
          entityId: appeal.id,
          beforeState: { status: appeal.status },
          afterState: { status: targetStatus },
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

