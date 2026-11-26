import { Router } from 'express';
import { z } from 'zod';
import {
  DiscrepancyStatus,
  LedgerEventType,
  Prisma,
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
import { recordAuditLog } from '../lib/audit';
import { refreshCentreAlerts } from '../services/alert.service';
import { acquireStockLock, getCentreBatchBalances } from '../services/ledger.service';
import { roundQty } from '../lib/math';

export const discrepancyRouter = Router();

discrepancyRouter.use(requireAuth);

discrepancyRouter.get('/', async (req, res, next) => {
  try {
    const statusFilter =
      typeof req.query.status === 'string' &&
      ['OPEN', 'RECOUNT_REQUESTED', 'APPROVED', 'REJECTED', 'RESOLVED'].includes(req.query.status)
        ? (req.query.status as DiscrepancyStatus)
        : undefined;

    let where: Prisma.DiscrepancyCaseWhereInput = {};
    if (req.user!.role === Role.SUPPLIER) {
      where = { dispatch: { supplierId: req.user!.supplierId ?? '__none__' } };
    } else {
      where = { dispatch: { destinationCentre: buildCentreScopeWhere(req.user!) } };
    }
    if (statusFilter) where.status = statusFilter;

    const cases = await prisma.discrepancyCase.findMany({
      where,
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
    });

    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
});

discrepancyRouter.get('/:id', async (req, res, next) => {
  try {
    const c = await prisma.discrepancyCase.findUnique({
      where: { id: String(req.params.id) },
      include: {
        dispatch: {
          include: {
            supplier: true,
            destinationCentre: { include: { sector: { include: { block: true } } } },
            items: { include: { product: true, batch: true } },
          },
        },
        deliveryReceipt: {
          include: {
            items: { include: { product: true, batch: true } },
            receiver: { select: { id: true, name: true, role: true } },
          },
        },
        resolver: { select: { id: true, name: true, role: true } },
      },
    });
    if (!c) throw new AppError(404, 'NOT_FOUND', 'Discrepancy case not found');

    if (req.user!.role === Role.SUPPLIER) {
      if (c.dispatch.supplierId !== req.user!.supplierId) {
        throw new AppError(403, 'SCOPE_FORBIDDEN', 'Not authorised');
      }
    } else {
      await assertCentreInScope(req.user!, c.dispatch.destinationCentreId);
    }

    const approvals = await prisma.approval.findMany({
      where: { entityType: 'DISCREPANCY', entityId: c.id },
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: { ...c, approvals } });
  } catch (err) {
    next(err);
  }
});

const reviewDiscrepancySchema = z.object({
  action: z.enum(['APPROVE', 'REQUEST_RECOUNT', 'REJECT', 'RESOLVE']),
  remarks: z.string().min(3, 'Remarks are mandatory for administrative decisions').max(500).trim(),
});

const statusFromAction: Record<string, DiscrepancyStatus> = {
  APPROVE: DiscrepancyStatus.APPROVED,
  REQUEST_RECOUNT: DiscrepancyStatus.RECOUNT_REQUESTED,
  REJECT: DiscrepancyStatus.REJECTED,
  RESOLVE: DiscrepancyStatus.RESOLVED,
};

discrepancyRouter.post(
  '/:id/review',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = reviewDiscrepancySchema.parse(req.body);
      const existing = await prisma.discrepancyCase.findUnique({
        where: { id: String(req.params.id) },
        include: { dispatch: true },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Discrepancy case not found');

      await assertCentreInScope(req.user!, existing.dispatch.destinationCentreId);

      const newStatus = statusFromAction[parsed.action];

      const updated = await prisma.$transaction(async (tx) => {
        const caseRow = await tx.discrepancyCase.update({
          where: { id: existing.id },
          data: {
            status: newStatus,
            resolutionRemarks: parsed.remarks,
            resolvedBy: req.user!.id,
            resolvedAt: new Date(),
          },
        });

        await tx.approval.create({
          data: {
            entityType: 'DISCREPANCY',
            entityId: existing.id,
            action: parsed.action,
            actorId: req.user!.id,
            remarks: parsed.remarks,
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: `DISCREPANCY_${parsed.action}`,
          entityType: 'DiscrepancyCase',
          entityId: existing.id,
          beforeState: { status: existing.status },
          afterState: { status: newStatus },
          remarks: parsed.remarks,
        });

        return caseRow;
      });

      await refreshCentreAlerts(existing.dispatch.destinationCentreId);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

discrepancyRouter.post(
  '/:id/resolve',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          remarks: z.string().min(3, 'Resolution remarks are required').max(500).trim(),
        })
        .parse(req.body);

      const existing = await prisma.discrepancyCase.findUnique({
        where: { id: String(req.params.id) },
        include: { dispatch: true },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Discrepancy case not found');

      await assertCentreInScope(req.user!, existing.dispatch.destinationCentreId);

      const updated = await prisma.$transaction(async (tx) => {
        const caseRow = await tx.discrepancyCase.update({
          where: { id: existing.id },
          data: {
            status: DiscrepancyStatus.RESOLVED,
            resolutionRemarks: parsed.remarks,
            resolvedBy: req.user!.id,
            resolvedAt: new Date(),
          },
        });

        await tx.approval.create({
          data: {
            entityType: 'DISCREPANCY',
            entityId: existing.id,
            action: 'RESOLVE',
            actorId: req.user!.id,
            remarks: parsed.remarks,
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'DISCREPANCY_RESOLVE',
          entityType: 'DiscrepancyCase',
          entityId: existing.id,
          beforeState: { status: existing.status },
          afterState: { status: DiscrepancyStatus.RESOLVED },
          remarks: parsed.remarks,
        });

        return caseRow;
      });

      await refreshCentreAlerts(existing.dispatch.destinationCentreId);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// Unified approvals router for SPOILAGE, RECONCILIATION, and DISCREPANCY
export const approvalRouter = Router();
approvalRouter.use(requireAuth);

const approvalBodySchema = z.object({
  entityType: z.enum(['SPOILAGE', 'RECONCILIATION', 'DISCREPANCY']),
  remarks: z.string().min(3, 'Remarks are mandatory for approval/rejection').max(500).trim(),
});

async function handleApprovalDecision(
  decision: 'APPROVED' | 'REJECTED',
  entityId: string,
  entityType: 'SPOILAGE' | 'RECONCILIATION' | 'DISCREPANCY',
  remarks: string,
  user: NonNullable<Express.Request['user']>
) {
  if (entityType === 'SPOILAGE') {
    const report = await prisma.spoilageReport.findUnique({ where: { id: entityId } });
    if (!report) throw new AppError(404, 'NOT_FOUND', 'Spoilage report not found');
    await assertCentreInScope(user, report.centreId);
    if (report.status !== SpoilageStatus.PENDING) {
      throw new AppError(400, 'ALREADY_REVIEWED', 'Spoilage report has already been reviewed');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.spoilageReport.update({
        where: { id: report.id },
        data: {
          status: decision === 'APPROVED' ? SpoilageStatus.APPROVED : SpoilageStatus.REJECTED,
          reviewedBy: user.id,
          reviewRemarks: remarks,
          reviewedAt: new Date(),
        },
      });

      if (decision === 'APPROVED') {
        await acquireStockLock(tx, report.centreId, report.productId);
        const batches = await getCentreBatchBalances(report.centreId, tx, {
          productId: report.productId,
          includeZero: true,
        });
        const targetBatch = batches.find((b) => b.batchId === report.batchId);
        if (!targetBatch || targetBatch.balance < roundQty(report.quantity)) {
          throw new AppError(
            409,
            'INSUFFICIENT_STOCK',
            `Cannot approve spoilage of ${report.quantity}; current batch balance is ${targetBatch?.balance ?? 0}`
          );
        }
        await tx.stockLedgerEvent.create({
          data: {
            centreId: report.centreId,
            productId: report.productId,
            batchId: report.batchId,
            eventType: LedgerEventType.SPOILAGE,
            quantity: roundQty(report.quantity),
            referenceId: report.id,
            referenceType: 'SPOILAGE_REPORT',
            remarks: `Approved spoilage (${report.reason}): ${remarks}`,
            idempotencyKey: `spoil-ev-${report.id}`,
            createdBy: user.id,
          },
        });
      }

      await tx.approval.create({
        data: {
          entityType: 'SPOILAGE',
          entityId: report.id,
          action: decision,
          actorId: user.id,
          remarks,
        },
      });

      await recordAuditLog(tx, {
        actorId: user.id,
        action: `SPOILAGE_${decision}`,
        entityType: 'SpoilageReport',
        entityId: report.id,
        beforeState: { status: report.status },
        afterState: { status: row.status },
        remarks,
      });

      return row;
    });

    await refreshCentreAlerts(report.centreId);
    return updated;
  }

  if (entityType === 'RECONCILIATION') {
    const recon = await prisma.reconciliation.findUnique({ where: { id: entityId } });
    if (!recon) throw new AppError(404, 'NOT_FOUND', 'Reconciliation record not found');
    await assertCentreInScope(user, recon.centreId);
    if (recon.status !== ReconciliationStatus.PENDING_APPROVAL) {
      throw new AppError(400, 'ALREADY_REVIEWED', 'Reconciliation has already been reviewed');
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (decision === 'APPROVED' && recon.variance !== 0) {
        await acquireStockLock(tx, recon.centreId, recon.productId);
        const lockedBatches = await getCentreBatchBalances(recon.centreId, tx, {
          productId: recon.productId,
          includeZero: true,
        });
        const lockedTarget = lockedBatches.find((b) => b.batchId === recon.batchId);
        if (!lockedTarget || roundQty(lockedTarget.balance + recon.variance) < 0) {
          throw new AppError(409, 'NEGATIVE_STOCK_PREVENTED', 'Reconciliation adjustment would drive batch balance negative');
        }
      }

      const row = await tx.reconciliation.update({
        where: { id: recon.id },
        data: {
          status:
            decision === 'APPROVED'
              ? ReconciliationStatus.APPROVED
              : ReconciliationStatus.REJECTED,
          approvedBy: user.id,
          approvalRemarks: remarks,
          approvedAt: new Date(),
        },
      });

      if (decision === 'APPROVED') {
        if (recon.variance !== 0) {
          await tx.stockLedgerEvent.create({
            data: {
              centreId: recon.centreId,
              productId: recon.productId,
              batchId: recon.batchId,
              eventType:
                recon.variance > 0
                  ? LedgerEventType.ADJUSTMENT_IN
                  : LedgerEventType.ADJUSTMENT_OUT,
              quantity: Math.abs(roundQty(recon.variance)),
              referenceId: recon.id,
              referenceType: 'RECONCILIATION',
              remarks: `Approved reconciliation adjustment (${recon.variance}): ${remarks}`,
              idempotencyKey: `recon-adj-${recon.id}`,
              createdBy: user.id,
            },
          });
        } else {
          await tx.stockLedgerEvent.create({
            data: {
              centreId: recon.centreId,
              productId: recon.productId,
              batchId: recon.batchId,
              eventType: LedgerEventType.RECONCILIATION,
              quantity: 0,
              referenceId: recon.id,
              referenceType: 'RECONCILIATION',
              remarks: `Physical stock matched ledger: ${remarks}`,
              idempotencyKey: `recon-match-${recon.id}`,
              createdBy: user.id,
            },
          });
        }
      }

      await tx.approval.create({
        data: {
          entityType: 'RECONCILIATION',
          entityId: recon.id,
          action: decision,
          actorId: user.id,
          remarks,
        },
      });

      await recordAuditLog(tx, {
        actorId: user.id,
        action: `RECONCILIATION_${decision}`,
        entityType: 'Reconciliation',
        entityId: recon.id,
        beforeState: { status: recon.status },
        afterState: { status: row.status, variance: recon.variance },
        remarks,
      });

      return row;
    });

    await refreshCentreAlerts(recon.centreId);
    return updated;
  }

  // DISCREPANCY
  const disc = await prisma.discrepancyCase.findUnique({
    where: { id: entityId },
    include: { dispatch: true },
  });
  if (!disc) throw new AppError(404, 'NOT_FOUND', 'Discrepancy case not found');
  await assertCentreInScope(user, disc.dispatch.destinationCentreId);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.discrepancyCase.update({
      where: { id: disc.id },
      data: {
        status: decision === 'APPROVED' ? DiscrepancyStatus.APPROVED : DiscrepancyStatus.REJECTED,
        resolutionRemarks: remarks,
        resolvedBy: user.id,
        resolvedAt: new Date(),
      },
    });
    await tx.approval.create({
      data: {
        entityType: 'DISCREPANCY',
        entityId: disc.id,
        action: decision,
        actorId: user.id,
        remarks,
      },
    });
    await recordAuditLog(tx, {
      actorId: user.id,
      action: `DISCREPANCY_${decision}`,
      entityType: 'DiscrepancyCase',
      entityId: disc.id,
      beforeState: { status: disc.status },
      afterState: { status: row.status },
      remarks,
    });
    return row;
  });

  await refreshCentreAlerts(disc.dispatch.destinationCentreId);
  return updated;
}

approvalRouter.post(
  '/:id/approve',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = approvalBodySchema.parse(req.body);
      const data = await handleApprovalDecision(
        'APPROVED',
        String(req.params.id),
        parsed.entityType,
        parsed.remarks,
        req.user!
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

approvalRouter.post(
  '/:id/reject',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = approvalBodySchema.parse(req.body);
      const data = await handleApprovalDecision(
        'REJECTED',
        String(req.params.id),
        parsed.entityType,
        parsed.remarks,
        req.user!
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

