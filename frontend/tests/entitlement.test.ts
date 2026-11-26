import { describe, expect, it } from 'vitest';
import { computeOfflineEntitlementSummary, formatIstMonth, OutboxRecord } from '../src/lib/offlineDb';
import type {
  BeneficiaryReference,
  EntitlementRule,
  MonthlyDistributionLite,
  ProductInventorySummary,
} from '../src/types';

const rules: EntitlementRule[] = [
  {
    id: 'rule-child',
    beneficiaryCategory: 'CHILD_6M_3Y',
    productId: 'prod-bal',
    monthlyLimit: 7,
    packetWeightGrams: 500,
    packetWeightLabel: '500 g',
    isConfigured: true,
    isActive: true,
    notes: null,
    product: {
      id: 'prod-bal',
      code: 'THR-BAL',
      name: 'Balshakti (THR)',
      nameGu: 'બાળશક્તિ (THR)',
      category: 'THR',
      unit: 'packets',
    },
  },
  {
    id: 'rule-suw',
    beneficiaryCategory: 'SEVERELY_UNDERWEIGHT_CHILD_6M_3Y',
    productId: 'prod-bal',
    monthlyLimit: 10,
    packetWeightGrams: 500,
    packetWeightLabel: '500 g',
    isConfigured: true,
    isActive: true,
    notes: null,
    product: {
      id: 'prod-bal',
      code: 'THR-BAL',
      name: 'Balshakti (THR)',
      nameGu: 'બાળશક્તિ (THR)',
      category: 'THR',
      unit: 'packets',
    },
  },
  {
    id: 'rule-pw',
    beneficiaryCategory: 'PREGNANT_WOMAN',
    productId: 'prod-mat',
    monthlyLimit: 4,
    packetWeightGrams: 1000,
    packetWeightLabel: '1 kg',
    isConfigured: true,
    isActive: true,
    notes: null,
    product: {
      id: 'prod-mat',
      code: 'THR-MAT',
      name: 'Matrushakti (THR)',
      nameGu: 'માતૃશક્તિ (THR)',
      category: 'THR',
      unit: 'packets',
    },
  },
  {
    id: 'rule-lm',
    beneficiaryCategory: 'LACTATING_MOTHER',
    productId: 'prod-mat',
    monthlyLimit: 4,
    packetWeightGrams: 1000,
    packetWeightLabel: '1 kg',
    isConfigured: true,
    isActive: true,
    notes: null,
    product: {
      id: 'prod-mat',
      code: 'THR-MAT',
      name: 'Matrushakti (THR)',
      nameGu: 'માતૃશક્તિ (THR)',
      category: 'THR',
      unit: 'packets',
    },
  },
  {
    id: 'rule-ag',
    beneficiaryCategory: 'ADOLESCENT_GIRL',
    productId: 'prod-pur',
    monthlyLimit: null,
    packetWeightGrams: null,
    packetWeightLabel: null,
    isConfigured: false,
    isActive: true,
    notes: null,
    product: {
      id: 'prod-pur',
      code: 'THR-PUR',
      name: 'Purnashakti (THR)',
      nameGu: 'પૂર્ણાશક્તિ (THR)',
      category: 'THR',
      unit: 'packets',
    },
  },
];

const inventorySummary: ProductInventorySummary[] = [
  {
    productId: 'prod-bal',
    productName: 'Balshakti (THR)',
    productNameGu: 'બાળશક્તિ (THR)',
    category: 'THR',
    unit: 'packets',
    totalStock: 25,
    usableStock: 25,
    expiredStock: 0,
    averageDailyConsumption: 1,
    isConsumptionEstimated: false,
    daysOfStock: 25,
    reorderLevel: 'ADEQUATE',
    expiringSoonBatches: 0,
    expiredBatches: 0,
    batches: [],
  },
  {
    productId: 'prod-mat',
    productName: 'Matrushakti (THR)',
    productNameGu: 'માતૃશક્તિ (THR)',
    category: 'THR',
    unit: 'packets',
    totalStock: 12,
    usableStock: 12,
    expiredStock: 0,
    averageDailyConsumption: 1,
    isConsumptionEstimated: false,
    daysOfStock: 12,
    reorderLevel: 'ADEQUATE',
    expiringSoonBatches: 0,
    expiredBatches: 0,
    batches: [],
  },
  {
    productId: 'prod-pur',
    productName: 'Purnashakti (THR)',
    productNameGu: 'પૂર્ણાશક્તિ (THR)',
    category: 'THR',
    unit: 'packets',
    totalStock: 10,
    usableStock: 10,
    expiredStock: 0,
    averageDailyConsumption: 0,
    isConsumptionEstimated: true,
    daysOfStock: null,
    reorderLevel: 'ADEQUATE',
    expiringSoonBatches: 0,
    expiredBatches: 0,
    batches: [],
  },
];

function makeBeneficiary(
  id: string,
  category: BeneficiaryReference['beneficiaryCategory'],
  status: BeneficiaryReference['status'] = 'APPROVED'
): BeneficiaryReference {
  return {
    id,
    centreId: 'centre-1',
    localReference: `BEN-${id}`,
    displayName: `Beneficiary ${id}`,
    displayNameGu: null,
    yob: '2000',
    beneficiaryCategory: category,
    protectedCredentialReference: `cred-${id}`,
    status,
  };
}

describe('Offline Entitlement & Monthly Limit Computation', () => {
  it('computes IST month rollover accurately across midnight IST (18:30 UTC)', () => {
    expect(formatIstMonth(new Date('2026-11-30T18:29:59Z'))).toBe('2026-11');
    expect(formatIstMonth(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12');
  });

  it('auto-selects product, limit, and packet weight across categories and counts unsynced outbox items', () => {
    const child = makeBeneficiary('c1', 'CHILD_6M_3Y');
    const suwChild = makeBeneficiary('c2', 'SEVERELY_UNDERWEIGHT_CHILD_6M_3Y');
    const pw = makeBeneficiary('p1', 'PREGNANT_WOMAN');
    const lm = makeBeneficiary('l1', 'LACTATING_MOTHER');

    const monthlyDistributions: MonthlyDistributionLite[] = [
      {
        id: 'd1',
        beneficiaryReferenceId: 'c1',
        productId: 'prod-bal',
        quantity: 4,
        distributionDay: '2026-11-05',
        distributionMonth: '2026-11',
        distributedAt: '2026-11-05T05:00:00Z',
      },
    ];
    const outbox: OutboxRecord[] = [
      {
        operationUuid: 'op-1',
        operationType: 'DISTRIBUTION',
        centreId: 'centre-1',
        userId: 'u1',
        summaryLabel: 'Offline distribution',
        summaryLabelGu: 'વિતરણ',
        payload: {
          beneficiaryReferenceId: 'c1',
          productId: 'prod-bal',
          quantity: 2,
        },
        status: 'saved_locally',
        retryCount: 0,
        createdAt: '2026-11-26T06:00:00Z',
      },
    ];

    const c1Summary = computeOfflineEntitlementSummary({
      beneficiary: child,
      entitlementRules: rules,
      monthlyDistributions,
      inventorySummary,
      outbox,
      distributionMonth: '2026-11',
    });
    expect(c1Summary.product?.code).toBe('THR-BAL');
    expect(c1Summary.monthlyLimit).toBe(7);
    expect(c1Summary.packetWeightLabel).toBe('500 g');
    expect(c1Summary.distributedQuantity).toBe(6);
    expect(c1Summary.remainingQuantity).toBe(1);
    expect(c1Summary.maxAllocatable).toBe(1);
    expect(c1Summary.eligibilityStatus).toBe('ELIGIBLE');
    expect(c1Summary.canDistribute).toBe(true);

    const suwSummary = computeOfflineEntitlementSummary({
      beneficiary: suwChild,
      entitlementRules: rules,
      monthlyDistributions,
      inventorySummary,
      outbox,
      distributionMonth: '2026-11',
    });
    expect(suwSummary.monthlyLimit).toBe(10);
    expect(suwSummary.remainingQuantity).toBe(10);

    const pwSummary = computeOfflineEntitlementSummary({
      beneficiary: pw,
      entitlementRules: rules,
      monthlyDistributions,
      inventorySummary,
      outbox,
      distributionMonth: '2026-11',
    });
    expect(pwSummary.product?.code).toBe('THR-MAT');
    expect(pwSummary.monthlyLimit).toBe(4);
    expect(pwSummary.packetWeightLabel).toBe('1 kg');

    const lmSummary = computeOfflineEntitlementSummary({
      beneficiary: lm,
      entitlementRules: rules,
      monthlyDistributions,
      inventorySummary,
      outbox,
      distributionMonth: '2026-11',
    });
    expect(lmSummary.product?.code).toBe('THR-MAT');
    expect(lmSummary.monthlyLimit).toBe(4);
  });

  it('blocks distribution when exhausted, pending approval, out of stock, or pending configuration, and resets next calendar month', () => {
    const pw = makeBeneficiary('p2', 'PREGNANT_WOMAN');
    const ag = makeBeneficiary('a1', 'ADOLESCENT_GIRL');
    const pendingBen = makeBeneficiary('b-pend', 'CHILD_6M_3Y', 'PENDING_APPROVAL');

    const novExhaustedSummary = computeOfflineEntitlementSummary({
      beneficiary: pw,
      entitlementRules: rules,
      monthlyDistributions: [
        {
          id: 'd-pw',
          beneficiaryReferenceId: 'p2',
          productId: 'prod-mat',
          quantity: 4,
          distributionDay: '2026-11-10',
          distributionMonth: '2026-11',
          distributedAt: '2026-11-10T05:00:00Z',
        },
      ],
      inventorySummary,
      outbox: [],
      distributionMonth: '2026-11',
    });
    expect(novExhaustedSummary.eligibilityStatus).toBe('LIMIT_EXHAUSTED');
    expect(novExhaustedSummary.remainingQuantity).toBe(0);
    expect(novExhaustedSummary.canDistribute).toBe(false);

    const decResetSummary = computeOfflineEntitlementSummary({
      beneficiary: pw,
      entitlementRules: rules,
      monthlyDistributions: [
        {
          id: 'd-pw',
          beneficiaryReferenceId: 'p2',
          productId: 'prod-mat',
          quantity: 4,
          distributionDay: '2026-11-10',
          distributionMonth: '2026-11',
          distributedAt: '2026-11-10T05:00:00Z',
        },
      ],
      inventorySummary,
      outbox: [],
      distributionMonth: '2026-12',
    });
    expect(decResetSummary.eligibilityStatus).toBe('ELIGIBLE');
    expect(decResetSummary.distributedQuantity).toBe(0);
    expect(decResetSummary.remainingQuantity).toBe(4);
    expect(decResetSummary.canDistribute).toBe(true);

    const agPendingSummary = computeOfflineEntitlementSummary({
      beneficiary: ag,
      entitlementRules: rules,
      monthlyDistributions: [],
      inventorySummary,
      outbox: [],
      distributionMonth: '2026-11',
    });
    expect(agPendingSummary.eligibilityStatus).toBe('PENDING_CONFIGURATION');
    expect(agPendingSummary.canDistribute).toBe(false);

    const verificationPendingSummary = computeOfflineEntitlementSummary({
      beneficiary: pendingBen,
      entitlementRules: rules,
      monthlyDistributions: [],
      inventorySummary,
      outbox: [],
      distributionMonth: '2026-11',
    });
    expect(verificationPendingSummary.eligibilityStatus).toBe('VERIFICATION_REQUIRED');
    expect(verificationPendingSummary.canDistribute).toBe(false);

    const noStockSummary = computeOfflineEntitlementSummary({
      beneficiary: pw,
      entitlementRules: rules,
      monthlyDistributions: [],
      inventorySummary: inventorySummary.map((p) =>
        p.productId === 'prod-mat' ? { ...p, usableStock: 0 } : p
      ),
      outbox: [],
      distributionMonth: '2026-11',
    });
    expect(noStockSummary.eligibilityStatus).toBe('INSUFFICIENT_STOCK');
    expect(noStockSummary.canDistribute).toBe(false);
  });
});

