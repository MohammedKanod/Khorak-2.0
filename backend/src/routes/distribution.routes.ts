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
import { acquireStockLock, allocateFefoBatches } from '../services/ledger.service';
import { refreshCentreAlerts } from '../services/alert.service';
import { recordAuditLog } from '../lib/audit';
import { formatIstDate, formatIstMonth, roundQty } from '../lib/math';
import {
  acquireEntitlementLock,
  ensureDefaultEntitlementRules,
  getBeneficiaryEntitlementSummary,
} from '../services/entitlement.service';

export const distributionRouter = Router();
export const beneficiaryRouter = Router();

distributionRouter.use(requireAuth);
beneficiaryRouter.use(requireAuth);

const beneficiaryPublicSelect = {
  id: true,
  centreId: true,
  localReference: true,
  displayName: true,
  displayNameGu: true,
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
} as const;

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
      select: beneficiaryPublicSelect,
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
  yob: z.string().regex(/^(19|20)\d{2}$/, 'Enter 4-digit birth year (YYYY)'),
  beneficiaryCategory: z.enum([
    'PREGNANT_WOMAN',
    'LACTATING_MOTHER',
    'CHILD_6M_3Y',
    'SEVERELY_UNDERWEIGHT_CHILD_6M_3Y',
    'CHILD_3Y_6Y',
    'ADOLESCENT_GIRL',
  ]),
  protectedCredentialReference: z.string().min(32).max(128).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export async function executeCreateBeneficiary(params: {
  userId: string;
  userRole: Role;
  centreId: string;
  localReference?: string;
  displayName: string;
  displayNameGu?: string;
  yob: string;
  beneficiaryCategory: BeneficiaryCategory;
  protectedCredentialReference?: string;
  idempotencyKey?: string;
}) {
  if (params.idempotencyKey) {
    const existingByKey = await prisma.beneficiaryReference.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      select: beneficiaryPublicSelect,
    });
    if (existingByKey) {
      return { beneficiary: existingByKey, deduplicated: true };
    }
  }

  const centre = await prisma.anganwadiCentre.findUnique({
    where: { id: params.centreId },
    select: { id: true, code: true },
  });
  if (!centre) {
    throw new AppError(404, 'CENTRE_NOT_FOUND', 'Anganwadi Centre not found');
  }

  // Opaque credential reference: either locally HMAC-derived from offline QR
  // or opaque random token for manual registration (never stores Aadhaar digits)
  const credRef =
    params.protectedCredentialReference ||
    `manual-${crypto.randomBytes(24).toString('hex')}`;

  const duplicate = await prisma.beneficiaryReference.findFirst({
    where: {
      OR: [
        { protectedCredentialReference: credRef },
        {
          centreId: params.centreId,
          displayName: { equals: params.displayName, mode: 'insensitive' },
          yob: params.yob,
          isActive: true,
        },
      ],
    },
  });

  if (duplicate) {
    throw new AppError(
      409,
      'BENEFICIARY_EXISTS',
      'This beneficiary is already registered at this centre'
    );
  }

  const localReference =
    params.localReference ||
    `BEN-${centre.code.replace('AWC-', '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  const autoApprove =
    params.userRole === Role.SUPERVISOR || params.userRole === Role.CDPO;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.beneficiaryReference.create({
      data: {
        centreId: params.centreId,
        localReference,
        displayName: params.displayName,
        displayNameGu: params.displayNameGu || null,
        maskedIdLast4: null,
        yob: params.yob,
        beneficiaryCategory: params.beneficiaryCategory,
        protectedCredentialReference: credRef,
        status: autoApprove
          ? BeneficiaryStatus.APPROVED
          : BeneficiaryStatus.PENDING_APPROVAL,
        requestedBy: params.userId,
        reviewedBy: autoApprove ? params.userId : null,
        reviewRemarks: autoApprove ? 'Added and approved by authorised officer' : null,
        reviewedAt: autoApprove ? new Date() : null,
        idempotencyKey: params.idempotencyKey || null,
      },
      select: beneficiaryPublicSelect,
    });

    await recordAuditLog(tx, {
      actorId: params.userId,
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

  return { beneficiary: created, deduplicated: false };
}

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

      await assertCentreInScope(req.user!, centreId);
      const result = await executeCreateBeneficiary({
        userId: req.user!.id,
        userRole: req.user!.role,
        centreId,
        localReference: parsed.localReference,
        displayName: parsed.displayName,
        displayNameGu: parsed.displayNameGu,
        yob: parsed.yob,
        beneficiaryCategory: parsed.beneficiaryCategory as BeneficiaryCategory,
        protectedCredentialReference: parsed.protectedCredentialReference,
        idempotencyKey: parsed.idempotencyKey,
      });

      res.status(result.deduplicated ? 200 : 201).json({
        success: true,
        data: result.beneficiary,
        deduplicated: result.deduplicated,
      });
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
          select: beneficiaryPublicSelect,
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
            : { localReference: parsed.localReference }),
        },
        select: beneficiaryPublicSelect,
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
      const [todaysDistributions, entitlement] = await Promise.all([
        prisma.distribution.findMany({
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
        }),
        getBeneficiaryEntitlementSummary(prisma, {
          beneficiaryId: beneficiary.id,
          centreId,
        }),
      ]);

      res.json({
        success: true,
        data: {
          beneficiary,
          todaysDistributions,
          entitlement,
          verificationMode: 'LOCAL_OFFLINE_XML_MAPPING',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

const distributionLineItemSchema = z.object({
  productId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive(),
});

const createDistributionSchema = z
  .object({
    centreId: z.string().uuid().optional(),
    beneficiaryReferenceId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    quantity: z.coerce.number().positive().optional(),
    items: z.array(distributionLineItemSchema).min(1).optional(),
    distributedAt: z.string().optional(),
    idempotencyKey: z.string().min(8).max(120).optional(),
    remarks: z.string().max(300).optional(),
    exceptionOverride: z.boolean().optional(),
    exceptionReason: z.string().max(400).trim().optional(),
  })
  .refine(
    (d) => (Array.isArray(d.items) && d.items.length > 0) || d.quantity !== undefined,
    { message: 'Provide either items[] or quantity' }
  );

const ADMIN_OVERRIDE_ROLES: Role[] = [Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO];

export async function executeMultiDistribution(params: {
  userId: string;
  userRole?: Role;
  centreId: string;
  beneficiaryReferenceId: string;
  items: Array<{ productId?: string; batchId?: string; quantity: number }>;
  distributedAt?: Date;
  idempotencyKey: string;
  remarks?: string;
  exceptionOverride?: boolean;
  exceptionReason?: string;
}) {
  const keyMatches = await prisma.distribution.findMany({
    where: {
      OR: [
        { idempotencyKey: params.idempotencyKey },
        { idempotencyKey: { startsWith: `${params.idempotencyKey}-item-` } },
      ],
    },
    include: {
      beneficiary: {
        select: {
          id: true,
          localReference: true,
          displayName: true,
          displayNameGu: true,
          beneficiaryCategory: true,
        },
      },
      product: { select: { id: true, name: true, nameGu: true, unit: true } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
    },
  });

  if (keyMatches.length > 0) {
    return {
      distributions: keyMatches,
      distribution: keyMatches[0],
      deduplicated: true,
    };
  }

  const beneficiary = await prisma.beneficiaryReference.findFirst({
    where: {
      id: params.beneficiaryReferenceId,
      centreId: params.centreId,
      isActive: true,
    },
  });
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

  const isExceptionOverride = Boolean(params.exceptionOverride);
  if (isExceptionOverride) {
    if (!params.userRole || !ADMIN_OVERRIDE_ROLES.includes(params.userRole)) {
      throw new AppError(
        403,
        'EXCEPTION_FORBIDDEN',
        'Only authorised Supervisors/Officers can approve an entitlement exception'
      );
    }
    if (!params.exceptionReason || params.exceptionReason.trim().length < 5) {
      throw new AppError(
        400,
        'EXCEPTION_REASON_REQUIRED',
        'A detailed exception reason (min 5 characters) is mandatory for audit compliance'
      );
    }
  }

  await ensureDefaultEntitlementRules(prisma);
  const rule = await prisma.entitlementRule.findUnique({
    where: { beneficiaryCategory: beneficiary.beneficiaryCategory },
    include: { product: true },
  });

  if (!isExceptionOverride) {
    if (
      !rule ||
      !rule.isActive ||
      !rule.isConfigured ||
      !rule.productId ||
      rule.monthlyLimit === null
    ) {
      throw new AppError(
        400,
        'ENTITLEMENT_NOT_CONFIGURED',
        `Entitlement for category ${beneficiary.beneficiaryCategory} is pending official confirmation and cannot be automatically allocated`
      );
    }
  }

  const resolvedItems: Array<{ productId: string; batchId?: string; quantity: number }> = [];
  const productSet = new Set<string>();
  for (const rawItem of params.items) {
    const qty = roundQty(rawItem.quantity);
    if (qty <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'Distribution quantity must be positive');
    }
    const targetProductId = rawItem.productId || rule?.productId;
    if (!targetProductId) {
      throw new AppError(
        400,
        'PRODUCT_REQUIRED',
        'No entitled product configured for this beneficiary category'
      );
    }
    if (!isExceptionOverride && rule?.productId && targetProductId !== rule.productId) {
      throw new AppError(
        403,
        'ENTITLEMENT_PRODUCT_MISMATCH',
        `Beneficiary category ${beneficiary.beneficiaryCategory} is only entitled to ${rule.product?.name || 'its configured nutrition product'}`
      );
    }
    if (productSet.has(targetProductId)) {
      throw new AppError(
        400,
        'DUPLICATE_PRODUCT_IN_REQUEST',
        'Duplicate product in distribution items'
      );
    }
    productSet.add(targetProductId);
    resolvedItems.push({ productId: targetProductId, batchId: rawItem.batchId, quantity: qty });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(productSet) }, isActive: true },
  });
  if (products.length !== productSet.size) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'One or more products not found or inactive');
  }
  const productMap = new Map(products.map((p) => [p.id, p]));

  const distTime = params.distributedAt || new Date();
  const distributionDay = formatIstDate(distTime);
  const distributionMonth = formatIstMonth(distTime);

  let createdList;
  try {
    createdList = await prisma.$transaction(async (tx) => {
      const results = [];

      // Serialize concurrent allocations for the same beneficiary + calendar month
      await acquireEntitlementLock(tx, params.beneficiaryReferenceId, distributionMonth);

      // Deterministic lock ordering by productId prevents deadlocks under concurrency
      const sortedItems = [...resolvedItems].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      );

      for (let itemIdx = 0; itemIdx < sortedItems.length; itemIdx++) {
        const line = sortedItems[itemIdx];
        const product = productMap.get(line.productId)!;

        let alreadyDistributed = 0;
        if (!isExceptionOverride && rule && rule.monthlyLimit !== null) {
          const agg = await tx.distribution.aggregate({
            _sum: { quantity: true },
            where: {
              centreId: params.centreId,
              beneficiaryReferenceId: params.beneficiaryReferenceId,
              productId: line.productId,
              distributionMonth,
            },
          });
          alreadyDistributed = roundQty(agg._sum.quantity || 0);
          const remaining = Math.max(0, roundQty(rule.monthlyLimit - alreadyDistributed));
          if (roundQty(alreadyDistributed + line.quantity) > rule.monthlyLimit) {
            if (remaining <= 0) {
              throw new AppError(
                409,
                'ENTITLEMENT_EXHAUSTED',
                `Monthly limit of ${rule.monthlyLimit} ${product.unit} reached for ${beneficiary.displayName} in ${distributionMonth}`
              );
            }
            throw new AppError(
              400,
              'ENTITLEMENT_LIMIT_EXCEEDED',
              `Requested ${line.quantity} ${product.unit} exceeds remaining monthly entitlement of ${remaining} (${alreadyDistributed}/${rule.monthlyLimit} distributed in ${distributionMonth})`
            );
          }
        }

        await acquireStockLock(tx, params.centreId, line.productId);

        const allocations = await allocateFefoBatches(tx, {
          centreId: params.centreId,
          productId: line.productId,
          quantity: line.quantity,
          preferredBatchId: line.batchId,
        });

        const itemIdempKey =
          sortedItems.length === 1
            ? params.idempotencyKey
            : `${params.idempotencyKey}-item-${itemIdx}`;

        const primaryAlloc = allocations[0];
        const distribution = await tx.distribution.create({
          data: {
            centreId: params.centreId,
            beneficiaryReferenceId: params.beneficiaryReferenceId,
            productId: line.productId,
            batchId: primaryAlloc.batchId,
            quantity: roundQty(line.quantity),
            distributedBy: params.userId,
            distributedAt: distTime,
            distributionDay,
            distributionMonth,
            idempotencyKey: itemIdempKey,
            isExceptionOverride,
            exceptionReason: isExceptionOverride ? params.exceptionReason!.trim() : null,
            remarks: params.remarks,
          },
          include: {
            beneficiary: {
              select: {
                id: true,
                localReference: true,
                displayName: true,
                displayNameGu: true,
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
              productId: line.productId,
              batchId: alloc.batchId,
              eventType: LedgerEventType.DISTRIBUTED,
              quantity: alloc.quantity,
              referenceId: distribution.id,
              referenceType: 'DISTRIBUTION',
              remarks: `Distributed ${product.name} to ${beneficiary.localReference} (batch ${alloc.batchNumber})`,
              idempotencyKey:
                allocations.length === 1
                  ? `dist-led-${itemIdempKey}`
                  : `dist-led-${itemIdempKey}-${idx}`,
              createdBy: params.userId,
            },
          });
        }

        await recordAuditLog(tx, {
          actorId: params.userId,
          action: isExceptionOverride
            ? 'BENEFICIARY_DISTRIBUTION_OVERRIDE'
            : 'BENEFICIARY_DISTRIBUTION',
          entityType: 'Distribution',
          entityId: distribution.id,
          afterState: {
            beneficiaryLocalRef: beneficiary.localReference,
            beneficiaryCategory: beneficiary.beneficiaryCategory,
            productId: line.productId,
            quantity: line.quantity,
            distributionMonth,
            priorDistributedThisMonth: alreadyDistributed,
            monthlyLimit: rule?.monthlyLimit ?? null,
            isExceptionOverride,
            allocations,
          },
          remarks: isExceptionOverride ? params.exceptionReason!.trim() : params.remarks,
        });

        results.push(distribution);
      }

      return results;
    });
  } catch (err) {
    // Database-level duplicate distribution constraint (P2002)
    const prismaErr = err as { code?: string; meta?: { target?: string[] } };
    if (prismaErr?.code === 'P2002') {
      const target = prismaErr.meta?.target || [];
      if (target.includes('idempotencyKey')) {
        const retryMatches = await prisma.distribution.findMany({
          where: {
            OR: [
              { idempotencyKey: params.idempotencyKey },
              { idempotencyKey: { startsWith: `${params.idempotencyKey}-item-` } },
            ],
          },
          include: {
            beneficiary: { select: { id: true, localReference: true, displayName: true, displayNameGu: true, beneficiaryCategory: true } },
            product: { select: { id: true, name: true, nameGu: true, unit: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          },
        });
        if (retryMatches.length > 0) {
          return {
            distributions: retryMatches,
            distribution: retryMatches[0],
            deduplicated: true,
          };
        }
      }
      throw new AppError(
        409,
        'DUPLICATE_DISTRIBUTION',
        `${beneficiary.displayName} has already received this product on ${distributionDay}`
      );
    }
    throw err;
  }

  await refreshCentreAlerts(params.centreId);
  return {
    distributions: createdList,
    distribution: createdList[0],
    deduplicated: false,
  };
}

export async function executeDistribution(params: {
  userId: string;
  userRole?: Role;
  centreId: string;
  beneficiaryReferenceId: string;
  productId?: string;
  batchId?: string;
  quantity: number;
  distributedAt?: Date;
  idempotencyKey: string;
  remarks?: string;
}) {
  return executeMultiDistribution({
    userId: params.userId,
    userRole: params.userRole,
    centreId: params.centreId,
    beneficiaryReferenceId: params.beneficiaryReferenceId,
    items: [
      {
        productId: params.productId,
        batchId: params.batchId,
        quantity: params.quantity,
      },
    ],
    distributedAt: params.distributedAt,
    idempotencyKey: params.idempotencyKey,
    remarks: params.remarks,
  });
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

      const items =
        parsed.items && parsed.items.length > 0
          ? parsed.items
          : [
              {
                productId: parsed.productId,
                batchId: parsed.batchId,
                quantity: parsed.quantity!,
              },
            ];

      const result = await executeMultiDistribution({
        userId: req.user!.id,
        userRole: req.user!.role,
        centreId,
        beneficiaryReferenceId: parsed.beneficiaryReferenceId,
        items,
        distributedAt: parsed.distributedAt ? new Date(parsed.distributedAt) : undefined,
        idempotencyKey,
        remarks: parsed.remarks,
        exceptionOverride: parsed.exceptionOverride,
        exceptionReason: parsed.exceptionReason,
      });

      res.status(result.deduplicated ? 200 : 201).json({
        success: true,
        data: items.length > 1 ? result.distributions : result.distribution,
        distributions: result.distributions,
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
