import { BeneficiaryCategory, BeneficiaryStatus, Prisma, PrismaClient } from '@prisma/client';
import { formatIstMonth, roundQty } from '../lib/math';
import { getCentreBatchBalances } from './ledger.service';

export type EntitlementDbClient = PrismaClient | Prisma.TransactionClient;

export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'LIMIT_EXHAUSTED'
  | 'INSUFFICIENT_STOCK'
  | 'PENDING_CONFIGURATION'
  | 'VERIFICATION_REQUIRED';

export interface EntitlementBlueprint {
  beneficiaryCategory: BeneficiaryCategory;
  productCode: string | null;
  monthlyLimit: number | null;
  packetWeightGrams: number | null;
  packetWeightLabel: string | null;
  isConfigured: boolean;
  isActive: boolean;
  notes: string;
}

export const DEFAULT_ENTITLEMENT_BLUEPRINTS: EntitlementBlueprint[] = [
  {
    beneficiaryCategory: BeneficiaryCategory.CHILD_6M_3Y,
    productCode: 'THR-BAL',
    monthlyLimit: 7,
    packetWeightGrams: 500,
    packetWeightLabel: '500 g',
    isConfigured: true,
    isActive: true,
    notes: 'Child 6 months–3 years (Normal Weight): 7 packets (500 g each) per calendar month',
  },
  {
    beneficiaryCategory: BeneficiaryCategory.SEVERELY_UNDERWEIGHT_CHILD_6M_3Y,
    productCode: 'THR-BAL',
    monthlyLimit: 10,
    packetWeightGrams: 500,
    packetWeightLabel: '500 g',
    isConfigured: true,
    isActive: true,
    notes: 'Severely Underweight Child 6 months–3 years: 10 packets (500 g each) per calendar month',
  },
  {
    beneficiaryCategory: BeneficiaryCategory.PREGNANT_WOMAN,
    productCode: 'THR-MAT',
    monthlyLimit: 4,
    packetWeightGrams: 1000,
    packetWeightLabel: '1 kg',
    isConfigured: true,
    isActive: true,
    notes: 'Pregnant Woman: 4 packets (1 kg each) per calendar month',
  },
  {
    beneficiaryCategory: BeneficiaryCategory.LACTATING_MOTHER,
    productCode: 'THR-MAT',
    monthlyLimit: 4,
    packetWeightGrams: 1000,
    packetWeightLabel: '1 kg',
    isConfigured: true,
    isActive: true,
    notes: 'Lactating Mother: 4 packets (1 kg each) per calendar month',
  },
  {
    beneficiaryCategory: BeneficiaryCategory.ADOLESCENT_GIRL,
    productCode: 'THR-PUR',
    monthlyLimit: null,
    packetWeightGrams: null,
    packetWeightLabel: null,
    isConfigured: false,
    isActive: true,
    notes: 'Adolescent Girl (Kishori) — Purnashakti quantity and packet weight pending official confirmation',
  },
  {
    beneficiaryCategory: BeneficiaryCategory.CHILD_3Y_6Y,
    productCode: null,
    monthlyLimit: null,
    packetWeightGrams: null,
    packetWeightLabel: null,
    isConfigured: false,
    isActive: false,
    notes: 'Child 3–6 years — served via Hot Cooked Meal (HCM); no automatic THR packet entitlement',
  },
];

export async function acquireEntitlementLock(
  tx: Prisma.TransactionClient,
  beneficiaryReferenceId: string,
  distributionMonth: string
): Promise<void> {
  const lockKey = `entitlement:${beneficiaryReferenceId}:${distributionMonth}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export async function ensureDefaultEntitlementRules(db: EntitlementDbClient): Promise<void> {
  const existingCount = await db.entitlementRule.count();
  if (existingCount >= DEFAULT_ENTITLEMENT_BLUEPRINTS.length) {
    return;
  }

  const products = await db.product.findMany({
    select: { id: true, code: true },
  });
  const productByCode = new Map(products.map((p) => [p.code, p.id]));

  for (const bp of DEFAULT_ENTITLEMENT_BLUEPRINTS) {
    const productId = bp.productCode ? productByCode.get(bp.productCode) ?? null : null;
    await db.entitlementRule.upsert({
      where: { beneficiaryCategory: bp.beneficiaryCategory },
      update: {},
      create: {
        beneficiaryCategory: bp.beneficiaryCategory,
        productId,
        monthlyLimit: bp.monthlyLimit,
        packetWeightGrams: bp.packetWeightGrams,
        packetWeightLabel: bp.packetWeightLabel,
        isConfigured: bp.isConfigured,
        isActive: bp.isActive,
        notes: bp.notes,
      },
    });
  }
}

export async function getBeneficiaryEntitlementSummary(
  db: EntitlementDbClient,
  params: {
    beneficiaryId: string;
    centreId: string;
    referenceDate?: Date;
  }
) {
  await ensureDefaultEntitlementRules(db);

  const beneficiary = await db.beneficiaryReference.findFirst({
    where: {
      id: params.beneficiaryId,
      centreId: params.centreId,
      isActive: true,
    },
    select: {
      id: true,
      centreId: true,
      localReference: true,
      displayName: true,
      displayNameGu: true,
      yob: true,
      beneficiaryCategory: true,
      status: true,
    },
  });

  if (!beneficiary) {
    return null;
  }

  const rule = await db.entitlementRule.findUnique({
    where: { beneficiaryCategory: beneficiary.beneficiaryCategory },
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
    },
  });

  const distributionMonth = formatIstMonth(params.referenceDate ?? new Date());
  const distributionsThisMonth = rule?.productId
    ? await db.distribution.findMany({
        where: {
          centreId: params.centreId,
          beneficiaryReferenceId: beneficiary.id,
          productId: rule.productId,
          distributionMonth,
        },
        select: {
          id: true,
          quantity: true,
          distributedAt: true,
          distributionDay: true,
          distributionMonth: true,
          isExceptionOverride: true,
          batch: { select: { batchNumber: true } },
        },
        orderBy: { distributedAt: 'desc' },
      })
    : [];

  const distributedQuantity = roundQty(
    distributionsThisMonth.reduce((sum, d) => sum + d.quantity, 0)
  );

  const usableBatches = rule?.productId
    ? (
        await getCentreBatchBalances(params.centreId, db, {
          productId: rule.productId,
          includeZero: false,
        })
      ).filter((b) => b.isUsable)
    : [];

  const usableStock = roundQty(usableBatches.reduce((sum, b) => sum + b.balance, 0));

  const monthlyLimit =
    rule?.isConfigured && rule.monthlyLimit !== null ? roundQty(rule.monthlyLimit) : null;
  const remainingQuantity =
    monthlyLimit !== null ? Math.max(0, roundQty(monthlyLimit - distributedQuantity)) : null;

  let eligibilityStatus: EligibilityStatus;
  if (beneficiary.status !== BeneficiaryStatus.APPROVED) {
    eligibilityStatus = 'VERIFICATION_REQUIRED';
  } else if (!rule || !rule.isActive || !rule.isConfigured || !rule.productId || monthlyLimit === null) {
    eligibilityStatus = 'PENDING_CONFIGURATION';
  } else if (remainingQuantity !== null && remainingQuantity <= 0) {
    eligibilityStatus = 'LIMIT_EXHAUSTED';
  } else if (usableStock <= 0) {
    eligibilityStatus = 'INSUFFICIENT_STOCK';
  } else {
    eligibilityStatus = 'ELIGIBLE';
  }

  const maxAllocatable =
    eligibilityStatus === 'ELIGIBLE' && remainingQuantity !== null
      ? Math.max(0, Math.floor(Math.min(remainingQuantity, usableStock)))
      : 0;

  return {
    beneficiary,
    rule,
    product: rule?.product ?? null,
    distributionMonth,
    monthlyLimit,
    packetWeightGrams: rule?.packetWeightGrams ?? null,
    packetWeightLabel: rule?.packetWeightLabel ?? null,
    distributedQuantity,
    remainingQuantity,
    usableStock,
    maxAllocatable,
    eligibilityStatus,
    canDistribute: eligibilityStatus === 'ELIGIBLE',
    distributionsThisMonth,
  };
}

