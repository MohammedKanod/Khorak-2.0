import { Router } from 'express';
import { z } from 'zod';
import { BeneficiaryCategory, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { assertCentreInScope, requireAuth, requireRoles } from '../middleware/auth';
import { recordAuditLog } from '../lib/audit';
import {
  ensureDefaultEntitlementRules,
  getBeneficiaryEntitlementSummary,
} from '../services/entitlement.service';

export const entitlementsRouter = Router();

entitlementsRouter.use(requireAuth);

entitlementsRouter.get('/', async (_req, res, next) => {
  try {
    await ensureDefaultEntitlementRules(prisma);
    const rules = await prisma.entitlementRule.findMany({
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            nameGu: true,
            category: true,
            unit: true,
          },
        },
        updater: { select: { id: true, name: true, role: true } },
      },
      orderBy: { beneficiaryCategory: 'asc' },
    });

    res.json({ success: true, data: rules });
  } catch (err) {
    next(err);
  }
});

entitlementsRouter.get('/beneficiary/:beneficiaryId', async (req, res, next) => {
  try {
    if (req.user!.role === Role.SUPPLIER) {
      throw new AppError(403, 'FORBIDDEN', 'Suppliers cannot access beneficiary entitlement profiles');
    }

    const beneficiary = await prisma.beneficiaryReference.findUnique({
      where: { id: String(req.params.beneficiaryId) },
      select: { id: true, centreId: true, isActive: true },
    });
    if (!beneficiary || !beneficiary.isActive) {
      throw new AppError(404, 'BENEFICIARY_NOT_FOUND', 'Beneficiary reference not found');
    }

    await assertCentreInScope(req.user!, beneficiary.centreId);

    let referenceDate = new Date();
    if (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)) {
      referenceDate = new Date(`${req.query.month}-15T06:00:00Z`);
    }

    const summary = await getBeneficiaryEntitlementSummary(prisma, {
      beneficiaryId: beneficiary.id,
      centreId: beneficiary.centreId,
      referenceDate,
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

const updateRuleSchema = z
  .object({
    productId: z.string().uuid().nullable().optional(),
    monthlyLimit: z.coerce.number().positive().max(100).nullable(),
    packetWeightGrams: z.coerce.number().int().positive().max(10000).nullable(),
    packetWeightLabel: z.string().min(1).max(30).trim().nullable(),
    isConfigured: z.boolean(),
    isActive: z.boolean().default(true),
    notes: z.string().max(400).trim().optional(),
    reason: z.string().min(3, 'Audit reason is required').max(300).trim(),
  })
  .refine(
    (d) =>
      !d.isConfigured ||
      (d.monthlyLimit !== null &&
        d.monthlyLimit > 0 &&
        d.packetWeightGrams !== null &&
        d.packetWeightLabel !== null),
    {
      message:
        'Confirmed entitlement rules require positive monthlyLimit, packetWeightGrams, and packetWeightLabel',
    }
  );

entitlementsRouter.put(
  '/:category',
  requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.DDO),
  async (req, res, next) => {
    try {
      const categoryParam = String(req.params.category);
      if (
        !Object.values(BeneficiaryCategory).includes(categoryParam as BeneficiaryCategory)
      ) {
        throw new AppError(400, 'INVALID_CATEGORY', 'Invalid beneficiary category');
      }

      const category = categoryParam as BeneficiaryCategory;
      const parsed = updateRuleSchema.parse(req.body);
      await ensureDefaultEntitlementRules(prisma);

      const existing = await prisma.entitlementRule.findUnique({
        where: { beneficiaryCategory: category },
      });
      if (!existing) {
        throw new AppError(404, 'RULE_NOT_FOUND', 'Entitlement rule not found');
      }

      const targetProductId =
        parsed.productId !== undefined ? parsed.productId : existing.productId;
      if (parsed.isConfigured && !targetProductId) {
        throw new AppError(400, 'PRODUCT_REQUIRED', 'A valid productId is required when configured');
      }
      if (targetProductId) {
        const prod = await prisma.product.findUnique({ where: { id: targetProductId } });
        if (!prod || !prod.isActive) {
          throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Selected nutrition product not found');
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.entitlementRule.update({
          where: { id: existing.id },
          data: {
            productId: targetProductId,
            monthlyLimit: parsed.monthlyLimit,
            packetWeightGrams: parsed.packetWeightGrams,
            packetWeightLabel: parsed.packetWeightLabel,
            isConfigured: parsed.isConfigured,
            isActive: parsed.isActive,
            ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
            updatedBy: req.user!.id,
          },
          include: {
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                nameGu: true,
                category: true,
                unit: true,
              },
            },
            updater: { select: { id: true, name: true, role: true } },
          },
        });

        await recordAuditLog(tx, {
          actorId: req.user!.id,
          action: 'ENTITLEMENT_RULE_UPDATED',
          entityType: 'EntitlementRule',
          entityId: row.id,
          beforeState: {
            productId: existing.productId,
            monthlyLimit: existing.monthlyLimit,
            packetWeightGrams: existing.packetWeightGrams,
            isConfigured: existing.isConfigured,
            isActive: existing.isActive,
          },
          afterState: {
            productId: row.productId,
            monthlyLimit: row.monthlyLimit,
            packetWeightGrams: row.packetWeightGrams,
            isConfigured: row.isConfigured,
            isActive: row.isActive,
          },
          remarks: parsed.reason,
        });

        return row;
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

