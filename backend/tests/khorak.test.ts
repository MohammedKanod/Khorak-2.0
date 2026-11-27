import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { classifyReorderLevel } from '../src/services/ledger.service';
import { computeHmacCredentialRef } from '../src/lib/credential';

const app = createApp();

async function loginAs(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'Khorak@2026' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body.data.accessToken;
}

describe('KHORAK Acceptance & Supply Chain Integrity Tests', () => {
  let awwToken: string;
  let supplierToken: string;
  let supervisorToken: string;
  let ddoToken: string;
  let cdpoToken: string;

  let vavdiCentreId: string;
  let vavdiSalt: string;
  let balShaktiId: string;
  let matruShaktiId: string;
  let gcmmflId: string;
  let gscscId: string;
  let beneficiaryPoojaId: string;
  let expiredBatchId: string;
  let activeMatBatchId: string;

  beforeAll(async () => {
    awwToken = await loginAs('aww.vavdi');
    supplierToken = await loginAs('supplier.gcmmfl');
    supervisorToken = await loginAs('sup.godhra');
    ddoToken = await loginAs('ddo.panchmahal');
    cdpoToken = await loginAs('cdpo.godhra');

    const centre = await prisma.anganwadiCentre.findUniqueOrThrow({
      where: { code: 'AWC-GDR-01' },
    });
    vavdiCentreId = centre.id;
    vavdiSalt = centre.offlineCredentialSalt || '';
    expect(vavdiSalt.length).toBeGreaterThanOrEqual(16);

    const bal = await prisma.product.findUniqueOrThrow({ where: { code: 'THR-BAL' } });
    const mat = await prisma.product.findUniqueOrThrow({ where: { code: 'THR-MAT' } });
    balShaktiId = bal.id;
    matruShaktiId = mat.id;

    const sup = await prisma.supplier.findUniqueOrThrow({ where: { code: 'GCMMFL-PMH' } });
    gcmmflId = sup.id;
    const otherSup = await prisma.supplier.findUniqueOrThrow({ where: { code: 'GSCSC-GDR' } });
    gscscId = otherSup.id;

    const ben = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-001' },
    });
    beneficiaryPoojaId = ben.id;

    const expBatch = await prisma.productBatch.findFirstOrThrow({
      where: { batchNumber: 'BAL-2026-MAY02' },
    });
    expiredBatchId = expBatch.id;

    const matBatch = await prisma.productBatch.findFirstOrThrow({
      where: { batchNumber: 'MAT-2026-NOV05' },
    });
    activeMatBatchId = matBatch.id;
  });

  it('Test A: Dispatch 100 packets, receive 80, automatically create 20-packet discrepancy & supervisor resolves', async () => {
    const batchNum = `TEST-DSP-${Date.now()}`;
    const createRes = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('destinationCentreId', vavdiCentreId)
      .field('vehicleNumber', 'GJ-17-AB-1234')
      .field('notes', 'Test A dispatch 100 packets')
      .field(
        'items',
        JSON.stringify([
          {
            productId: balShaktiId,
            batchNumber: batchNum,
            expiryDate: new Date(Date.now() + 90 * 86400000).toISOString(),
            expectedQuantity: 100,
          },
        ])
      )
      .attach('evidence', Buffer.from('%PDF-1.4\n'), {
        filename: 'challan-test-a.pdf',
        contentType: 'application/pdf',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.vehicleNumber).toBe('GJ-17-AB-1234');
    expect(createRes.body.data.evidenceUrl).toBeTruthy();
    const dispatch = createRes.body.data;
    const item = dispatch.items[0];

    const receiveRes = await request(app)
      .post(`/api/dispatches/${dispatch.id}/receipt`)
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        idempotencyKey: `test-a-${Date.now()}`,
        notes: 'Only 80 packets arrived in crate',
        items: [
          {
            productId: balShaktiId,
            batchId: item.batchId,
            acceptedQuantity: 80,
            damagedQuantity: 0,
            missingQuantity: 20,
          },
        ],
      });

    expect(receiveRes.status).toBe(201);
    expect(receiveRes.body.data.discrepancyCase).toBeTruthy();
    expect(receiveRes.body.data.discrepancyCase.expectedQuantity).toBe(100);
    expect(receiveRes.body.data.discrepancyCase.actualQuantity).toBe(80);
    expect(receiveRes.body.data.discrepancyCase.difference).toBe(20);
    expect(receiveRes.body.data.discrepancyCase.missingQuantity).toBe(20);

    const discId = receiveRes.body.data.discrepancyCase.id;
    const reviewRes = await request(app)
      .post(`/api/discrepancies/${discId}/review`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        action: 'RESOLVE',
        remarks: 'Verified transit shortage with GCMMFL challan; replacement scheduled.',
      });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.data.status).toBe('RESOLVED');
  });

  it('Test B & C: Verify synthetic Aadhaar Offline XML QR credential (HMAC-SHA256), auto-resolve entitlement, record distribution, and block duplicates', async () => {
    // 1. Verify offline credential HMAC hash locally derived from Poojaben's synthetic Aadhaar XML + centre salt
    const hash = computeHmacCredentialRef({
      salt: vavdiSalt,
      last4: '4821',
      name: 'Poojaben Maheshbhai Bariya',
      yob: '1997',
    });
    const verifyRes = await request(app)
      .post('/api/beneficiaries/verify-offline-credential')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({ protectedCredentialReference: hash });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.beneficiary.id).toBe(beneficiaryPoojaId);
    expect(verifyRes.body.data.entitlement.product.id).toBe(matruShaktiId);
    expect(verifyRes.body.data.entitlement.monthlyLimit).toBe(4);
    expect(verifyRes.body.data.entitlement.remainingQuantity).toBe(4);
    expect(verifyRes.body.data.entitlement.eligibilityStatus).toBe('ELIGIBLE');
    expect(JSON.stringify(verifyRes.body)).not.toContain('4821');
    expect(JSON.stringify(verifyRes.body)).not.toContain('maskedIdLast4');

    const beforeInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const beforeMat = beforeInv.body.data.products.find((p: { productId: string }) => p.productId === matruShaktiId).usableStock;

    // Product auto-resolved by backend when omitted (Pregnant Woman -> Matru Shakti)
    const idempKey = `test-bc-dist-${Date.now()}`;
    const dist1 = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: beneficiaryPoojaId,
        quantity: 2,
        idempotencyKey: idempKey,
      });

    expect(dist1.status).toBe(201);
    expect(dist1.body.data.productId).toBe(matruShaktiId);

    // Retry with same idempotencyKey -> deduplicated, no second deduction
    const distRetry = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: beneficiaryPoojaId,
        quantity: 2,
        idempotencyKey: idempKey,
      });

    expect(distRetry.status).toBe(200);
    expect(distRetry.body.deduplicated).toBe(true);

    // Second attempt on same day with a new idempotencyKey -> rejected 409 DUPLICATE_DISTRIBUTION
    const distDupDay = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: beneficiaryPoojaId,
        quantity: 2,
        idempotencyKey: `test-bc-dup-${Date.now()}`,
      });

    expect(distDupDay.status).toBe(409);

    const afterInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const afterMat = afterInv.body.data.products.find((p: { productId: string }) => p.productId === matruShaktiId).usableStock;

    expect(afterMat).toBe(beforeMat - 2);
  });

  it('Test D: 40 units at 8 units daily consumption generates 5-day REORDER_WARNING', () => {
    const usable = 40;
    const avgDaily = 8;
    const days = usable / avgDaily;
    expect(days).toBe(5);
    expect(classifyReorderLevel(usable, days)).toBe('WARNING');
    expect(classifyReorderLevel(16, 2)).toBe('CRITICAL');
    expect(classifyReorderLevel(0, 0)).toBe('STOCKOUT');
    expect(classifyReorderLevel(80, 10)).toBe('NORMAL');
  });

  it('Test E: Prevent distribution from an expired batch', async () => {
    const kavyaSamBen = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-006' },
    });

    const res = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kavyaSamBen.id,
        productId: balShaktiId,
        batchId: expiredBatchId,
        quantity: 1,
        idempotencyKey: `test-e-exp-${Date.now()}`,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BATCH_EXPIRED');
  });

  it('Test F: Record physical stock variance without overwriting historical ledger events', async () => {
    const batchesRes = await request(app)
      .get(`/api/inventory/${vavdiCentreId}/batches?productId=${matruShaktiId}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    const matBatch = batchesRes.body.data.find((b: { batchId: string }) => b.batchId === activeMatBatchId);
    const ledgerBefore = await prisma.stockLedgerEvent.count({
      where: { centreId: vavdiCentreId, batchId: activeMatBatchId },
    });

    const physicalCount = matBatch.balance - 4;
    const reconRes = await request(app)
      .post('/api/inventory/reconciliation')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        centreId: vavdiCentreId,
        productId: matruShaktiId,
        batchId: activeMatBatchId,
        physicalStock: physicalCount,
        remarks: 'Physical shelf verification audit variance of 4',
        autoApprove: true,
      });

    expect(reconRes.status).toBe(201);
    expect(reconRes.body.data.variance).toBe(-4);
    expect(reconRes.body.data.status).toBe('APPROVED');

    const ledgerAfter = await prisma.stockLedgerEvent.count({
      where: { centreId: vavdiCentreId, batchId: activeMatBatchId },
    });
    // Appended compensating event instead of overwriting history
    expect(ledgerAfter).toBe(ledgerBefore + 1);
  });

  it('Test G: Record an offline transaction and synchronise it exactly once', async () => {
    const opUuid = `offline-op-${crypto.randomUUID()}`;
    const riceProduct = await prisma.product.findUniqueOrThrow({ where: { code: 'HCM-RICE' } });

    const push1 = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        operations: [
          {
            operationUuid: opUuid,
            operationType: 'CONSUMPTION',
            createdAt: new Date().toISOString(),
            payload: {
              productId: riceProduct.id,
              quantity: 2,
              remarks: 'Offline HCM lunch preparation',
            },
          },
        ],
      });

    expect(push1.status).toBe(200);
    expect(push1.body.data.results[0].status).toBe('SYNCED');

    // Re-sync same operationUuid -> deduplicated, not applied twice
    const push2 = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        operations: [
          {
            operationUuid: opUuid,
            operationType: 'CONSUMPTION',
            createdAt: new Date().toISOString(),
            payload: {
              productId: riceProduct.id,
              quantity: 2,
              remarks: 'Offline HCM lunch preparation',
            },
          },
        ],
      });

    expect(push2.status).toBe(200);
    expect(push2.body.data.results[0].status).toBe('SYNCED');
    expect(push2.body.data.results[0].deduplicated).toBe(true);

    const ledgerCount = await prisma.stockLedgerEvent.count({
      where: { idempotencyKey: { startsWith: opUuid } },
    });
    expect(ledgerCount).toBe(1);
  });

  it('Test H & I: Verify AWW cannot access district administration, while DDO can access district analytics', async () => {
    const awwDenied = await request(app)
      .get('/api/dashboard/district')
      .set('Authorization', `Bearer ${awwToken}`);
    expect(awwDenied.status).toBe(403);

    const ddoAllowed = await request(app)
      .get('/api/dashboard/district')
      .set('Authorization', `Bearer ${ddoToken}`);
    expect(ddoAllowed.status).toBe(200);
    expect(ddoAllowed.body.data.kpis.totalCentres).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(ddoAllowed.body.data.blocks)).toBe(true);
    expect(Array.isArray(ddoAllowed.body.data.nutritionIndicators)).toBe(true);
  });

  it('Test J: AWW adds beneficiary (PENDING_APPROVAL), blocked until Sevika approves, then distributes (zero Aadhaar digits exposed)', async () => {
    const credHash = computeHmacCredentialRef({
      salt: vavdiSalt,
      last4: '5519',
      name: 'Rekhaben Naranbhai Solanki',
      yob: '2000',
    });

    const createRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        displayName: 'Rekhaben Naranbhai Solanki',
        displayNameGu: 'રેખાબેન નારણભાઈ સોલંકી',
        yob: '2000',
        beneficiaryCategory: 'LACTATING_MOTHER',
        protectedCredentialReference: credHash,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('PENDING_APPROVAL');
    expect(JSON.stringify(createRes.body)).not.toContain('5519');
    expect(JSON.stringify(createRes.body)).not.toContain('maskedIdLast4');
    const newBenId = createRes.body.data.id;

    // Blocked before Sevika approval
    const verifyBlocked = await request(app)
      .post('/api/beneficiaries/verify-offline-credential')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({ protectedCredentialReference: credHash });
    expect(verifyBlocked.status).toBe(403);
    expect(verifyBlocked.body.error.code).toBe('BENEFICIARY_NOT_APPROVED');

    // Mukhya Sevika approves
    const approveRes = await request(app)
      .post(`/api/beneficiaries/${newBenId}/review`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        action: 'APPROVE',
        remarks: 'Verified physical register at Vavdi AWC-01',
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    // Now offline credential verifies and distribution succeeds
    const verifyOk = await request(app)
      .post('/api/beneficiaries/verify-offline-credential')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({ protectedCredentialReference: credHash });
    expect(verifyOk.status).toBe(200);

    const distOk = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: newBenId,
        quantity: 1,
        idempotencyKey: `test-j-${Date.now()}`,
      });
    expect(distOk.status).toBe(201);
    expect(distOk.body.data.productId).toBe(matruShaktiId);
  });

  it('Admin bundle returns all dashboard datasets in one call and enforces RBAC', async () => {
    const awwRes = await request(app)
      .get('/api/dashboard/admin-bundle')
      .set('Authorization', `Bearer ${awwToken}`);
    expect(awwRes.status).toBe(403);

    const ddoRes = await request(app)
      .get('/api/dashboard/admin-bundle')
      .set('Authorization', `Bearer ${ddoToken}`);
    expect(ddoRes.status).toBe(200);
    expect(ddoRes.body.data.metrics.kpis.totalCentres).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(ddoRes.body.data.discrepancies)).toBe(true);
    expect(Array.isArray(ddoRes.body.data.beneficiaries)).toBe(true);
    expect(Array.isArray(ddoRes.body.data.appeals)).toBe(true);
    expect(Array.isArray(ddoRes.body.data.stockRequests)).toBe(true);
    expect(Array.isArray(ddoRes.body.data.metrics.nutritionIndicators)).toBe(true);
    expect(JSON.stringify(ddoRes.body.data.beneficiaries)).not.toContain('maskedIdLast4');
  });

  it('Privacy check: /api/beneficiaries, /api/sync/pull, /api/dashboard/centre omit maskedIdLast4', async () => {
    const [benRes, pullRes, dashRes] = await Promise.all([
      request(app).get('/api/beneficiaries').set('Authorization', `Bearer ${awwToken}`),
      request(app).get('/api/sync/pull').set('Authorization', `Bearer ${awwToken}`),
      request(app).get(`/api/dashboard/centre?centreId=${vavdiCentreId}`).set('Authorization', `Bearer ${awwToken}`),
    ]);
    expect(benRes.status).toBe(200);
    expect(pullRes.status).toBe(200);
    expect(dashRes.status).toBe(200);
    expect(pullRes.body.data.centre.offlineCredentialSalt).toBeTruthy();
    expect(Array.isArray(pullRes.body.data.stockRequests)).toBe(true);
    for (const payload of [benRes.body, pullRes.body, dashRes.body]) {
      expect(JSON.stringify(payload)).not.toContain('maskedIdLast4');
    }
  });

  it('Entitlement Exception Override & Concurrency: Supervisor override is atomic/audited; concurrent requests never exceed stock or daily rules', async () => {
    const ben2 = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-002' },
    });
    const oil = await prisma.product.findUniqueOrThrow({ where: { code: 'HCM-OIL' } }); // 0 stock at Vavdi

    // 1. Ordinary AWW cannot bypass entitlement rules or supply mismatched product
    const awwMismatch = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: ben2.id,
        productId: matruShaktiId,
        quantity: 1,
        idempotencyKey: `mismatch-${Date.now()}`,
      });
    expect(awwMismatch.status).toBe(403);
    expect(awwMismatch.body.error.code).toBe('ENTITLEMENT_PRODUCT_MISMATCH');

    const awwOverride = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: ben2.id,
        productId: matruShaktiId,
        quantity: 1,
        exceptionOverride: true,
        exceptionReason: 'Attempting unauthorized override',
        idempotencyKey: `override-aww-${Date.now()}`,
      });
    expect(awwOverride.status).toBe(403);
    expect(awwOverride.body.error.code).toBe('EXCEPTION_FORBIDDEN');

    // 2. Multi-item override where 2nd item (Oil) has 0 stock -> 1st item (Bal Shakti) MUST roll back
    const beforeInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const beforeBal = beforeInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;

    const atomicFail = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        centreId: vavdiCentreId,
        beneficiaryReferenceId: ben2.id,
        exceptionOverride: true,
        exceptionReason: 'Supervisor special ration pack test',
        idempotencyKey: `atomic-fail-${Date.now()}`,
        items: [
          { productId: balShaktiId, quantity: 2 },
          { productId: oil.id, quantity: 1 },
        ],
      });
    expect(atomicFail.status).toBe(400);
    expect(atomicFail.body.error.code).toBe('INSUFFICIENT_STOCK');

    // Authorized Supervisor exception override requires reason and writes audit trail
    const overrideOk = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        centreId: vavdiCentreId,
        beneficiaryReferenceId: ben2.id,
        productId: matruShaktiId,
        quantity: 1,
        exceptionOverride: true,
        exceptionReason: 'Verified medical nutrition officer special allotment',
        idempotencyKey: `override-sup-ok-${Date.now()}`,
      });
    expect(overrideOk.status).toBe(201);
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityId: overrideOk.body.data.id, action: 'BENEFICIARY_DISTRIBUTION_OVERRIDE' },
    });
    expect(auditEntry).toBeTruthy();
    expect(auditEntry?.remarks).toContain('special allotment');

    const midInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const midBal = midInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;
    expect(midBal).toBe(beforeBal);

    // 3. Concurrent same-beneficiary, same-product, same-day distributions -> only 1 succeeds
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: ben2.id,
          quantity: 1,
          idempotencyKey: `conc-1-${Date.now()}`,
        }),
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: ben2.id,
          quantity: 1,
          idempotencyKey: `conc-2-${Date.now()}`,
        }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('Entitlement Rules: Category limits, monthly calendar reset, concurrent monthly lock, Adolescent Girl pending config & offline sync validation', async () => {
    const cdpoToken = await loginAs('cdpo.godhra');
    const [rulesRes, pullRes] = await Promise.all([
      request(app).get('/api/entitlements').set('Authorization', `Bearer ${awwToken}`),
      request(app).get('/api/sync/pull').set('Authorization', `Bearer ${awwToken}`),
    ]);
    expect(rulesRes.status).toBe(200);
    expect(rulesRes.body.data.length).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(pullRes.body.data.entitlementRules)).toBe(true);
    expect(Array.isArray(pullRes.body.data.monthlyDistributions)).toBe(true);

    // Verify all initial rule figures match specification
    const byCat = new Map(
      rulesRes.body.data.map((r: { beneficiaryCategory: string; monthlyLimit: number | null; packetWeightGrams: number | null; isConfigured: boolean; product?: { code: string } }) => [
        r.beneficiaryCategory,
        r,
      ])
    ) as Map<string, { monthlyLimit: number | null; packetWeightGrams: number | null; isConfigured: boolean; product?: { code: string } }>;
    expect(byCat.get('CHILD_6M_3Y')?.monthlyLimit).toBe(7);
    expect(byCat.get('CHILD_6M_3Y')?.packetWeightGrams).toBe(500);
    expect(byCat.get('CHILD_6M_3Y')?.product?.code).toBe('THR-BAL');
    expect(byCat.get('SEVERELY_UNDERWEIGHT_CHILD_6M_3Y')?.monthlyLimit).toBe(10);
    expect(byCat.get('SEVERELY_UNDERWEIGHT_CHILD_6M_3Y')?.packetWeightGrams).toBe(500);
    expect(byCat.get('PREGNANT_WOMAN')?.monthlyLimit).toBe(4);
    expect(byCat.get('PREGNANT_WOMAN')?.packetWeightGrams).toBe(1000);
    expect(byCat.get('LACTATING_MOTHER')?.monthlyLimit).toBe(4);
    expect(byCat.get('ADOLESCENT_GIRL')?.isConfigured).toBe(false);
    expect(byCat.get('ADOLESCENT_GIRL')?.monthlyLimit).toBeNull();

    // 1. Adolescent Girl (Purnashakti) pending confirmation cannot be allocated automatically
    const kishoriBen = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-004' },
    });
    const kishoriSummary = await request(app)
      .get(`/api/entitlements/beneficiary/${kishoriBen.id}`)
      .set('Authorization', `Bearer ${awwToken}`);
    expect(kishoriSummary.status).toBe(200);
    expect(kishoriSummary.body.data.eligibilityStatus).toBe('PENDING_CONFIGURATION');
    expect(kishoriSummary.body.data.canDistribute).toBe(false);

    const kishoriBlocked = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kishoriBen.id,
        quantity: 1,
        idempotencyKey: `kishori-blk-${Date.now()}`,
      });
    expect(kishoriBlocked.status).toBe(400);
    expect(kishoriBlocked.body.error.code).toBe('ENTITLEMENT_NOT_CONFIGURED');

    // AWW cannot modify entitlement rules (403)
    const awwCfgDenied = await request(app)
      .put('/api/entitlements/ADOLESCENT_GIRL')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        monthlyLimit: 4,
        packetWeightGrams: 1000,
        packetWeightLabel: '1 kg',
        isConfigured: true,
        isActive: true,
        reason: 'Unauthorized change attempt',
      });
    expect(awwCfgDenied.status).toBe(403);

    // 2. Concurrent requests across different days in the same month cannot exceed monthly limit
    // Kavya (SAM child, limit 10): request 6 on 2026-10-10 and concurrently request 5 on 2026-10-11 & 5 on 2026-10-12
    const kavyaBen = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-006' },
    });
    const seedOct = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kavyaBen.id,
        quantity: 6,
        distributedAt: '2026-10-10T10:00:00+05:30',
        idempotencyKey: `oct-kavya-6-${Date.now()}`,
      });
    expect(seedOct.status).toBe(201);

    const [octConc1, octConc2] = await Promise.all([
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: kavyaBen.id,
          quantity: 4,
          distributedAt: '2026-10-11T10:00:00+05:30',
          idempotencyKey: `oct-kavya-c1-${Date.now()}`,
        }),
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: kavyaBen.id,
          quantity: 4,
          distributedAt: '2026-10-12T10:00:00+05:30',
          idempotencyKey: `oct-kavya-c2-${Date.now()}`,
        }),
    ]);
    const octStatuses = [octConc1.status, octConc2.status].sort();
    expect(octStatuses).toEqual([201, 409]);

    // Total distributed in October 2026 must be exactly 10 (never 14)
    const octCheck = await request(app)
      .get(`/api/entitlements/beneficiary/${kavyaBen.id}?month=2026-10`)
      .set('Authorization', `Bearer ${awwToken}`);
    expect(octCheck.body.data.distributedQuantity).toBe(10);
    expect(octCheck.body.data.remainingQuantity).toBe(0);
    expect(octCheck.body.data.eligibilityStatus).toBe('LIMIT_EXHAUSTED');

    // 3. Monthly calendar boundary reset: September vs October vs November
    // Distributed 10 in 2026-10 does NOT block 2026-12!
    const decReset = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kavyaBen.id,
        quantity: 3,
        distributedAt: '2026-12-01T08:00:00+05:30',
        idempotencyKey: `dec-reset-${Date.now()}`,
      });
    expect(decReset.status).toBe(201);

    // 4. Offline sync push exceeding remaining entitlement -> flagged CONFLICT without allocating
    const octOverPush = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        operations: [
          {
            operationUuid: `sync-over-${Date.now()}`,
            operationType: 'DISTRIBUTION',
            createdAt: '2026-10-15T10:00:00+05:30',
            payload: {
              beneficiaryReferenceId: kavyaBen.id,
              quantity: 1,
              distributedAt: '2026-10-15T10:00:00+05:30',
            },
          },
        ],
      });
    expect(octOverPush.status).toBe(200);
    expect(octOverPush.body.data.results[0].status).toBe('CONFLICT');

    // 5. CDPO configures Adolescent Girl rule with audit reason -> becomes eligible
    const confirmKishori = await request(app)
      .put('/api/entitlements/ADOLESCENT_GIRL')
      .set('Authorization', `Bearer ${cdpoToken}`)
      .send({
        monthlyLimit: 4,
        packetWeightGrams: 1000,
        packetWeightLabel: '1 kg',
        isConfigured: true,
        isActive: true,
        reason: 'Confirmed by district ICDS circular for demo test',
      });
    expect(confirmKishori.status).toBe(200);
    expect(confirmKishori.body.data.isConfigured).toBe(true);

    const kishoriAfter = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kishoriBen.id,
        quantity: 2,
        idempotencyKey: `kishori-ok-${Date.now()}`,
      });
    expect(kishoriAfter.status).toBe(201);
  });

  it('Supplier ownership and strict receipt-line validation enforced', async () => {
    // Missing dispatch proof rejected
    const missingProof = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('destinationCentreId', vavdiCentreId)
      .field('vehicleNumber', 'GJ-17-AB-1234')
      .field(
        'items',
        JSON.stringify([
          {
            productId: balShaktiId,
            batchNumber: `NOPROOF-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 10,
          },
        ])
      );
    expect(missingProof.status).toBe(400);
    expect(missingProof.body.error.code).toBe('DISPATCH_PROOF_REQUIRED');

    // Missing vehicle number rejected
    const missingVehicle = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('destinationCentreId', vavdiCentreId)
      .field(
        'items',
        JSON.stringify([
          {
            productId: balShaktiId,
            batchNumber: `NOVEH-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 10,
          },
        ])
      )
      .attach('evidence', Buffer.from('%PDF-1.4\n'), {
        filename: 'challan-noveh.pdf',
        contentType: 'application/pdf',
      });
    expect(missingVehicle.status).toBe(400);
    expect(missingVehicle.body.error.code).toBe('VALIDATION_ERROR');

    // Forging supplierId blocked
    const forged = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('supplierId', gscscId)
      .field('destinationCentreId', vavdiCentreId)
      .field('vehicleNumber', 'GJ-17-AB-9999')
      .field(
        'items',
        JSON.stringify([
          {
            productId: balShaktiId,
            batchNumber: `FORGE-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 10,
          },
        ])
      )
      .attach('evidence', Buffer.from('%PDF-1.4\n'), {
        filename: 'challan-forge.pdf',
        contentType: 'application/pdf',
      });
    expect(forged.status).toBe(403);

    // Create legitimate dispatch and test malformed receipt payloads
    const goodDispatch = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('destinationCentreId', vavdiCentreId)
      .field('vehicleNumber', 'GJ-17-CD-5678')
      .field(
        'items',
        JSON.stringify([
          {
            productId: balShaktiId,
            batchNumber: `VALID-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 20,
          },
        ])
      )
      .attach('evidence', Buffer.from('%PDF-1.4\n'), {
        filename: 'challan-valid.pdf',
        contentType: 'application/pdf',
      });
    expect(goodDispatch.status).toBe(201);
    const dsp = goodDispatch.body.data;

    // Duplicate line rejected
    const dupLine = await request(app)
      .post(`/api/dispatches/${dsp.id}/receipt`)
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        idempotencyKey: `dup-line-${Date.now()}`,
        items: [
          { productId: balShaktiId, batchId: dsp.items[0].batchId, acceptedQuantity: 10, damagedQuantity: 0, missingQuantity: 10 },
          { productId: balShaktiId, batchId: dsp.items[0].batchId, acceptedQuantity: 10, damagedQuantity: 0, missingQuantity: 10 },
        ],
      });
    expect(dupLine.status).toBe(400);

    // Mismatched total rejected
    const badTotal = await request(app)
      .post(`/api/dispatches/${dsp.id}/receipt`)
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        idempotencyKey: `bad-total-${Date.now()}`,
        items: [
          { productId: balShaktiId, batchId: dsp.items[0].batchId, acceptedQuantity: 15, damagedQuantity: 1, missingQuantity: 1 },
        ],
      });
    expect(badTotal.status).toBe(400);
  });

  it('Connected Workflow: Supervisor -> Supplier Dispatch Appeal lifecycle & authorization', async () => {
    const discCase = await prisma.discrepancyCase.findFirstOrThrow({
      where: {
        dispatch: { dispatchReference: 'DSP-GDR02-2026-DEMO02' },
      },
    });

    // AWW cannot raise supplier appeals
    const awwDenied = await request(app)
      .post('/api/appeals')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        discrepancyCaseId: discCase.id,
        supervisorRemarks: 'Testing unauthorized creation',
      });
    expect(awwDenied.status).toBe(403);

    // Supervisor creates and immediately submits appeal
    const createAppeal = await request(app)
      .post('/api/appeals')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        discrepancyCaseId: discCase.id,
        supervisorRemarks: 'Supervisor verified 8 missing/torn packets at Bamroli AWC-02.',
        submitImmediately: true,
      });
    expect(createAppeal.status).toBe(201);
    expect(createAppeal.body.data.status).toBe('AWAITING_SUPPLIER_RESPONSE');
    const appealId = createAppeal.body.data.id;

    // Owning supplier responds
    const supplierResp = await request(app)
      .post(`/api/appeals/${appealId}/respond`)
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        supplierRemarks: 'Verified crate weight log at depot; issuing 8-packet credit note & replacement batch.',
      });
    expect(supplierResp.status).toBe(200);
    expect(supplierResp.body.data.status).toBe('SUPPLIER_RESPONDED');

    // Supervisor resolves appeal
    const resolveAppeal = await request(app)
      .post(`/api/appeals/${appealId}/review`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        decision: 'RESOLVED',
        remarks: 'Replacement batch verified and appeal closed.',
      });
    expect(resolveAppeal.status).toBe(200);
    expect(resolveAppeal.body.data.status).toBe('RESOLVED');
    expect(resolveAppeal.body.data.history.length).toBeGreaterThanOrEqual(3);
  });

  it('Connected Workflow: AWW -> Supervisor -> Supplier Stock Request lifecycle + Offline Sync Queue', async () => {
    const dal = await prisma.product.findUniqueOrThrow({ where: { code: 'HCM-DAL' } });
    const reqUuid = `sync-req-${crypto.randomUUID()}`;
    const benUuid = `sync-ben-${crypto.randomUUID()}`;

    // Push offline beneficiary + stock request
    const syncRes = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        operations: [
          {
            operationUuid: benUuid,
            operationType: 'CREATE_BENEFICIARY',
            createdAt: new Date().toISOString(),
            payload: {
              displayName: 'Offline Sync Beneficiary',
              yob: '2022',
              beneficiaryCategory: 'CHILD_3Y_6Y',
            },
          },
          {
            operationUuid: reqUuid,
            operationType: 'CREATE_STOCK_REQUEST',
            createdAt: new Date().toISOString(),
            payload: {
              productId: dal.id,
              requestedQuantity: 25,
              reason: 'LOW_STOCK',
              remarks: 'Offline stock request for Toor Dal',
            },
          },
        ],
      });
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.data.results.every((r: { status: string }) => r.status === 'SYNCED')).toBe(true);
    const reqId = syncRes.body.data.results[1].data.id;

    // AWW cannot self-approve stock request
    const selfApprove = await request(app)
      .post(`/api/stock-requests/${reqId}/review`)
      .set('Authorization', `Bearer ${awwToken}`)
      .send({ decision: 'APPROVE', remarks: 'Self approve' });
    expect(selfApprove.status).toBe(403);

    // Check inventory before approval (approval MUST NOT increase inventory directly)
    const invBefore = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const dalBefore = invBefore.body.data.products.find((p: { productId: string }) => p.productId === dal.id).usableStock;

    const supApprove = await request(app)
      .post(`/api/stock-requests/${reqId}/review`)
      .set('Authorization', `Bearer ${cdpoToken}`)
      .send({
        decision: 'PARTIAL_APPROVE',
        assignedSupplierId: gcmmflId,
        approvedQuantity: 20,
        remarks: 'Approved 20 kg for immediate dispatch',
      });
    expect(supApprove.status).toBe(200);
    expect(supApprove.body.data.status).toBe('PARTIALLY_APPROVED');
    expect(supApprove.body.data.approvedQuantity).toBe(20);

    const invAfterApprove = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const dalAfterApprove = invAfterApprove.body.data.products.find((p: { productId: string }) => p.productId === dal.id).usableStock;
    expect(dalAfterApprove).toBe(dalBefore);

    // Supplier dispatches linked to stockRequestId
    const dispatchReq = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .field('destinationCentreId', vavdiCentreId)
      .field('stockRequestId', reqId)
      .field('vehicleNumber', 'GJ-17-EF-2026')
      .field('notes', 'Fulfilling approved Toor Dal request')
      .field(
        'items',
        JSON.stringify([
          {
            productId: dal.id,
            batchNumber: `REQ-DAL-${Date.now()}`,
            expiryDate: new Date(Date.now() + 120 * 86400000).toISOString(),
            expectedQuantity: 20,
          },
        ])
      )
      .attach('evidence', Buffer.from('%PDF-1.4\n'), {
        filename: 'challan-req.pdf',
        contentType: 'application/pdf',
      });
    expect(dispatchReq.status).toBe(201);

    const reqMid = await request(app)
      .get(`/api/stock-requests/${reqId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    expect(reqMid.body.data.status).toBe('DISPATCHED');

    // AWW receives dispatch -> StockRequest advances to COMPLETED
    const dspItem = dispatchReq.body.data.items[0];
    const recRes = await request(app)
      .post(`/api/dispatches/${dispatchReq.body.data.id}/receipt`)
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        idempotencyKey: `req-rec-${Date.now()}`,
        items: [
          {
            productId: dal.id,
            batchId: dspItem.batchId,
            acceptedQuantity: 20,
            damagedQuantity: 0,
            missingQuantity: 0,
          },
        ],
      });
    expect(recRes.status).toBe(201);

    const reqDone = await request(app)
      .get(`/api/stock-requests/${reqId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    expect(reqDone.body.data.status).toBe('COMPLETED');
  });
});
