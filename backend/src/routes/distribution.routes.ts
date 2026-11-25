import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  BeneficiaryCategory,
  BeneficiaryStatus,
  LedgerEventType,
  Prisma,
  Role,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCentreInScope,
  buildCentreScopeWhere,
  requireAuth,
  requireRoles,
} from '../middleware/auth';
import { allocateFefoBatches } from '../services/ledger.service';
import { refreshCentreAlerts } from '../services/alert.service';
import { recordAuditLog } from '../lib/audit';
import { formatIstDate, roundQty } from '../lib/math';

export const distributionRouter = Router();
export const beneficiaryRouter = Router();

distributionRouter.use(requireAuth);
beneficiaryRouter.use(requireAuth);

function computeProtectedCredentialRef(last4: string, name: string, yob: string): string {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const raw = `khorak-uidai-offline-v1|${last4.trim()}|${normalizedName}|${yob.trim()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

beneficiaryRouter.get('/', async (req, res, next) => {
  try {
    if (req.user!.role === Role.SUPPLIER) {
      throw new AppError(403, 'FORBIDDEN', 'Suppliers cannot access beneficiary references');
    }

    const centreId =
      typeof req.query.centreId === 'string' ? req.query.centreId : req.user!.centreId;
    const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
    const statusFilter =
      statusParam && ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(statusParam)
        ? (statusParam as BeneficiaryStatus)
        : undefined;

    const where: Prisma.BeneficiaryReferenceWhereInput = {
      ...(centreId ? { centreId } : {}),
      centre: buildCentreScopeWhere(req.user!),
      isActive: true,
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const beneficiaries = await prisma.beneficiaryReference.findMany({
      where,
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
    });

    res.json({ success: true, data: beneficiaries });
  } catch (err) {
    next(err);
  }
});

const createBeneficiarySchema = z.object({
  centreId: z.string().uuid().optional(),
  localReference: z.string().min(3).max(40).trim().optional(),
  displayName: z.string().min(2).max(120).trim(),
  displayNameGu: z.string().max(120).trim().optional(),
  maskedIdLast4: z.string().regex(/^\d{4}$/, 'Enter exactly the last 4 digits only'),
  yob: z.string().regex(/^(19|20)\d{2}$/, 'Enter 4-digit birth year (YYYY)'),
  beneficiaryCategory: z.enum([
    'PREGNANT_WOMAN',
    'LACTATING_MOTHER',
    'CHILD_6M_3Y',
    'CHILD_3Y_6Y',
    'ADOLESCENT_GIRL',
  ]),
});

beneficiaryRouter.post(
  '/',
  requireRoles(Role.AWW, Role.SUPERVISOR, Role.CDPO),
  async (req, res, next) => {
    try {
      const parsed = createBeneficiarySchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      const centre = await assertCentreInScope(req.user!, centreId);
      const protectedCredentialReference = computeProtectedCredentialRef(
        parsed.maskedIdLast4,
        parsed.displayName,
        parsed.yob
      );

      const existingCred = await prisma.beneficiaryReference.findUnique({
        where: { protectedCredentialReference },
      });
      if (existingCred) {
        throw new AppError(
          409,
          'BENEFICIARY_EXISTS',
          'A beneficiary reference with these credential details already exists'
        );
      }

      const localReference =
        parsed.localReference ||
        `BEN-${centre.code.replace('AWC-', '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const autoApprove =
        req.user!.role === Role.SUPERVISOR || req.user!.role === Role.CDPO;

      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.beneficiaryReference.create({
          data: {
            centreId,
            localReference,
            displayName: parsed.displayName,
            displayNameGu: parsed.displayNameGu || null,
            maskedIdLast4: parsed.maskedIdLast4,
            yob: parsed.yob,
            beneficiaryCategory: parsed.beneficiaryCategory as BeneficiaryCategory,
            protectedCredentialReference,
            status: autoApprove
              ? BeneficiaryStatus.APPROVED
              : BeneficiaryStatus.PENDING_APPROVAL,
            requestedBy: req.user!.id,
            reviewedBy: autoApprove ? req.user!.id : null,
            reviewRemarks: autoApprove ? 'Added and approved by authorised officer' : null,
            reviewedAt: autoApprove ? new Date() : null,
          },
          include: {
            centre: { select: { id: true, name: true, nameGu: true, code: true } },
            requester: { select: { id: true, name: true, role: true } },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: autoApprove ? 'BENEFICIARY_APPROVED' : 'BENEFICIARY_REQUESTED',
          entityType: 'BeneficiaryReference',
          entityId: row.id,
          afterState: {
            localReference: row.localReference,
            displayName: row.displayName,
            status: row.status,
          },
        });

        return row;
      });

      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

const reviewBeneficiarySchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  remarks: z.string().min(3, 'Remarks are required for approval or rejection').max(400).trim(),
});

beneficiaryRouter.post(
  '/:id/review',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const parsed = reviewBeneficiarySchema.parse(req.body);
      const existing = await prisma.beneficiaryReference.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!existing) {
        throw new AppError(404, 'BENEFICIARY_NOT_FOUND', 'Beneficiary reference not found');
      }

      await assertCentreInScope(req.user!, existing.centreId);

      const newStatus =
        parsed.action === 'APPROVE'
          ? BeneficiaryStatus.APPROVED
          : BeneficiaryStatus.REJECTED;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.beneficiaryReference.update({
          where: { id: existing.id },
          data: {
            status: newStatus,
            reviewedBy: req.user!.id,
            reviewRemarks: parsed.remarks,
            reviewedAt: new Date(),
          },
          include: {
            centre: { select: { id: true, name: true, code: true } },
            requester: { select: { id: true, name: true, role: true } },
            reviewer: { select: { id: true, name: true, role: true } },
          },
        });

        await tx.approval.create({
          data: {
            entityType: 'BENEFICIARY',
            entityId: existing.id,
            action: parsed.action,
            actorId: req.user!.id,
            remarks: parsed.remarks,
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: `BENEFICIARY_${parsed.action}`,
          entityType: 'BeneficiaryReference',
          entityId: existing.id,
          beforeState: { status: existing.status },
          afterState: { status: newStatus },
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

const verifyOfflineSchema = z.object({
  centreId: z.string().uuid().optional(),
  protectedCredentialReference: z.string().min(16).max(128).optional(),
  localReference: z.string().min(2).max(60).optional(),
  maskedIdLast4: z.string().regex(/^\d{4}$/).optional(),
});

beneficiaryRouter.post(
  '/verify-offline-credential',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const parsed = verifyOfflineSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);

      if (!parsed.protectedCredentialReference && !parsed.localReference) {
        throw new AppError(
          400,
          'CREDENTIAL_REQUIRED',
          'Provide protectedCredentialReference or localReference'
        );
      }

      const beneficiary = await prisma.beneficiaryReference.findFirst({
        where: {
          centreId,
          isActive: true,
          ...(parsed.protectedCredentialReference
            ? { protectedCredentialReference: parsed.protectedCredentialReference }
            : {
                localReference: parsed.localReference,
                ...(parsed.maskedIdLast4 ? { maskedIdLast4: parsed.maskedIdLast4 } : {}),
              }),
        },
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
        },
      });

      if (!beneficiary) {
        throw new AppError(
          404,
          'BENEFICIARY_NOT_FOUND',
          'No authorised beneficiary reference matches this offline credential at this centre'
        );
      }

      if (beneficiary.status !== BeneficiaryStatus.APPROVED) {
        throw new AppError(
          403,
          'BENEFICIARY_NOT_APPROVED',
          beneficiary.status === BeneficiaryStatus.PENDING_APPROVAL
            ? 'Beneficiary is awaiting Mukhya Sevika (Supervisor) approval before receiving rations'
            : 'Beneficiary request was rejected by Supervisor'
        );
      }

      const today = formatIstDate();
      const todaysDistributions = await prisma.distribution.findMany({
        where: {
          centreId,
          beneficiaryReferenceId: beneficiary.id,
          distributionDay: today,
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          distributedAt: true,
          product: { select: { name: true, nameGu: true, unit: true } },
        },
      });

      res.json({
        success: true,
        data: {
          beneficiary,
          todaysDistributions,
          verificationMode: 'LOCAL_OFFLINE_XML_MAPPING',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

const createDistributionSchema = z.object({
  centreId: z.string().uuid().optional(),
  beneficiaryReferenceId: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive(),
  distributedAt: z.string().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  remarks: z.string().max(300).optional(),
});

export async function executeDistribution(params: {
  userId: string;
  centreId: string;
  beneficiaryReferenceId: string;
  productId: string;
  batchId?: string;
  quantity: number;
  distributedAt?: Date;
  idempotencyKey: string;
  remarks?: string;
}) {
  const existingByKey = await prisma.distribution.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    include: {
      beneficiary: {
        select: {
          id: true,
          localReference: true,
          displayName: true,
          displayNameGu: true,
          maskedIdLast4: true,
        },
      },
      product: { select: { id: true, name: true, nameGu: true, unit: true } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
    },
  });

  if (existingByKey) {
    return { distribution: existingByKey, deduplicated: true };
  }

  const [beneficiary, product] = await Promise.all([
    prisma.beneficiaryReference.findFirst({
      where: {
        id: params.beneficiaryReferenceId,
        centreId: params.centreId,
        isActive: true,
      },
    }),
    prisma.product.findUnique({ where: { id: params.productId } }),
  ]);

  if (!beneficiary) {
    throw new AppError(
      404,
      'BENEFICIARY_NOT_FOUND',
      'Beneficiary reference not found in this Anganwadi Centre'
    );
  }
  if (beneficiary.status !== BeneficiaryStatus.APPROVED) {
    throw new AppError(
      403,
      'BENEFICIARY_NOT_APPROVED',
      'Beneficiary must be approved by Mukhya Sevika (Supervisor) before distribution'
    );
  }
  if (!product || !product.isActive) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found or inactive');
  }

  const distTime = params.distributedAt || new Date();
  const distributionDay = formatIstDate(distTime);

  const duplicateToday = await prisma.distribution.findFirst({
    where: {
      centreId: params.centreId,
      beneficiaryReferenceId: params.beneficiaryReferenceId,
      productId: params.productId,
      distributionDay,
    },
  });

  if (duplicateToday) {
    throw new AppError(
      409,
      'DUPLICATE_DISTRIBUTION',
      `${beneficiary.displayName} has already received ${product.name} on ${distributionDay}`
    );
  }

  const created = await prisma.$transaction(
    async (tx) => {
      const allocations = await allocateFefoBatches(tx, {
        centreId: params.centreId,
        productId: params.productId,
        quantity: params.quantity,
        preferredBatchId: params.batchId,
      });

      const primaryAlloc = allocations[0];
      const distribution = await tx.distribution.create({
        data: {
          centreId: params.centreId,
          beneficiaryReferenceId: params.beneficiaryReferenceId,
          productId: params.productId,
          batchId: primaryAlloc.batchId,
          quantity: roundQty(params.quantity),
          distributedBy: params.userId,
          distributedAt: distTime,
          distributionDay,
          idempotencyKey: params.idempotencyKey,
          remarks: params.remarks,
        },
        include: {
          beneficiary: {
            select: {
              id: true,
              localReference: true,
              displayName: true,
              displayNameGu: true,
              maskedIdLast4: true,
              beneficiaryCategory: true,
            },
          },
          product: { select: { id: true, name: true, nameGu: true, unit: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        },
      });

      for (let idx = 0; idx < allocations.length; idx++) {
        const alloc = allocations[idx];
        await tx.stockLedgerEvent.create({
          data: {
            centreId: params.centreId,
            productId: params.productId,
            batchId: alloc.batchId,
            eventType: LedgerEventType.DISTRIBUTED,
            quantity: alloc.quantity,
            referenceId: distribution.id,
            referenceType: 'DISTRIBUTION',
            remarks: `Distributed to ${beneficiary.localReference} (batch ${alloc.batchNumber})`,
            idempotencyKey:
              allocations.length === 1
                ? `dist-led-${params.idempotencyKey}`
                : `dist-led-${params.idempotencyKey}-${idx}`,
            createdBy: params.userId,
          },
        });
      }

      await recordAuditLog(tx, {
        actorId: params.userId,
        action: 'BENEFICIARY_DISTRIBUTION',
        entityType: 'Distribution',
        entityId: distribution.id,
        afterState: {
          beneficiaryLocalRef: beneficiary.localReference,
          productId: params.productId,
          quantity: params.quantity,
          allocations,
        },
        remarks: params.remarks,
      });

      return distribution;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  await refreshCentreAlerts(params.centreId);
  return { distribution: created, deduplicated: false };
}

distributionRouter.post(
  '/',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const parsed = createDistributionSchema.parse(req.body);
      const centreId = parsed.centreId || req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      await assertCentreInScope(req.user!, centreId);
      const idempotencyKey = parsed.idempotencyKey || `dist-${crypto.randomUUID()}`;

      const result = await executeDistribution({
        userId: req.user!.id,
        centreId,
        beneficiaryReferenceId: parsed.beneficiaryReferenceId,
        productId: parsed.productId,
        batchId: parsed.batchId,
        quantity: parsed.quantity,
        distributedAt: parsed.distributedAt ? new Date(parsed.distributedAt) : undefined,
        idempotencyKey,
        remarks: parsed.remarks,
      });

      res.status(result.deduplicated ? 200 : 201).json({
        success: true,
        data: result.distribution,
        deduplicated: result.deduplicated,
      });
    } catch (err) {
      next(err);
    }
  }
);

distributionRouter.get('/', async (req, res, next) => {
  try {
    if (req.user!.role === Role.SUPPLIER) {
      throw new AppError(403, 'FORBIDDEN', 'Suppliers cannot access beneficiary distribution records');
    }

    const centreId = typeof req.query.centreId === 'string' ? req.query.centreId : undefined;
    if (centreId) {
      await assertCentreInScope(req.user!, centreId);
    }

    const distributions = await prisma.distribution.findMany({
      where: {
        centre: buildCentreScopeWhere(req.user!),
        ...(centreId ? { centreId } : {}),
      },
      include: {
        centre: { select: { id: true, name: true, nameGu: true, code: true } },
        beneficiary: {
          select: {
            id: true,
            localReference: true,
            displayName: true,
            displayNameGu: true,
            maskedIdLast4: true,
            beneficiaryCategory: true,
          },
        },
        product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        worker: { select: { id: true, name: true, role: true } },
      },
      orderBy: { distributedAt: 'desc' },
      take: 200,
    });

    res.json({ success: true, data: distributions });
  } catch (err) {
    next(err);
  }
});

distributionRouter.get('/:id', async (req, res, next) => {
  try {
    const dist = await prisma.distribution.findUnique({
      where: { id: String(req.params.id) },
      include: {
        centre: true,
        beneficiary: {
          select: {
            id: true,
            localReference: true,
            displayName: true,
            displayNameGu: true,
            maskedIdLast4: true,
            beneficiaryCategory: true,
          },
        },
        product: true,
        batch: true,
        worker: { select: { id: true, name: true, role: true } },
      },
    });
    if (!dist) throw new AppError(404, 'NOT_FOUND', 'Distribution record not found');
    await assertCentreInScope(req.user!, dist.centreId);
    res.json({ success: true, data: dist });
  } catch (err) {
    next(err);
  }
});

