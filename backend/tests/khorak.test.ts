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
      .send({
        destinationCentreId: vavdiCentreId,
        notes: 'Test A dispatch 100 packets',
        items: [
          {
            productId: balShaktiId,
            batchNumber: batchNum,
            expiryDate: new Date(Date.now() + 90 * 86400000).toISOString(),
            expectedQuantity: 100,
          },
        ],
      });

    expect(createRes.status).toBe(201);
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

  it('Test B & C: Verify synthetic Aadhaar Offline XML QR credential (HMAC-SHA256), record distribution, and block duplicate submission', async () => {
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
    expect(JSON.stringify(verifyRes.body)).not.toContain('4821');
    expect(JSON.stringify(verifyRes.body)).not.toContain('maskedIdLast4');

    const beforeInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const beforeBal = beforeInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;

    const idempKey = `test-bc-dist-${Date.now()}`;
    const dist1 = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: beneficiaryPoojaId,
        productId: balShaktiId,
        quantity: 2,
        idempotencyKey: idempKey,
      });

    expect(dist1.status).toBe(201);

    // Retry with same idempotencyKey -> deduplicated, no second deduction
    const distRetry = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: beneficiaryPoojaId,
        productId: balShaktiId,
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
        productId: balShaktiId,
        quantity: 2,
        idempotencyKey: `test-bc-dup-${Date.now()}`,
      });

    expect(distDupDay.status).toBe(409);

    const afterInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const afterBal = afterInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;

    expect(afterBal).toBe(beforeBal - 2);
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
    const kajalBen = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-003' },
    });

    const res = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: kajalBen.id,
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
        productId: balShaktiId,
        quantity: 1,
        idempotencyKey: `test-j-${Date.now()}`,
      });
    expect(distOk.status).toBe(201);
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

  it('Multi-item distribution is atomic and concurrent duplicate/stock-limit requests never corrupt ledger', async () => {
    const ben2 = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-002' },
    });
    const oil = await prisma.product.findUniqueOrThrow({ where: { code: 'HCM-OIL' } }); // 0 stock at Vavdi

    const beforeInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const beforeBal = beforeInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;

    // 1. Multi-item where 2nd item (Oil) has 0 stock -> 1st item (Bal Shakti) MUST roll back
    const atomicFail = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: ben2.id,
        idempotencyKey: `atomic-fail-${Date.now()}`,
        items: [
          { productId: balShaktiId, quantity: 2 },
          { productId: oil.id, quantity: 1 },
        ],
      });
    expect(atomicFail.status).toBe(400);
    expect(atomicFail.body.error.code).toBe('INSUFFICIENT_STOCK');

    const midInv = await request(app)
      .get(`/api/inventory/${vavdiCentreId}`)
      .set('Authorization', `Bearer ${awwToken}`);
    const midBal = midInv.body.data.products.find((p: { productId: string }) => p.productId === balShaktiId).usableStock;
    expect(midBal).toBe(beforeBal);

    // 2. Concurrent same-beneficiary, same-product, same-day distributions -> only 1 succeeds (DB unique constraint)
    const rice = await prisma.product.findUniqueOrThrow({ where: { code: 'HCM-RICE' } });
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: ben2.id,
          productId: rice.id,
          quantity: 1,
          idempotencyKey: `conc-1-${Date.now()}`,
        }),
      request(app)
        .post('/api/distributions')
        .set('Authorization', `Bearer ${awwToken}`)
        .send({
          beneficiaryReferenceId: ben2.id,
          productId: rice.id,
          quantity: 1,
          idempotencyKey: `conc-2-${Date.now()}`,
        }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // 3. Valid multi-item distribution succeeds
    const ben4 = await prisma.beneficiaryReference.findFirstOrThrow({
      where: { centreId: vavdiCentreId, localReference: 'BEN-GDR01-004' },
    });
    const multiOk = await request(app)
      .post('/api/distributions')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        beneficiaryReferenceId: ben4.id,
        idempotencyKey: `multi-ok-${Date.now()}`,
        items: [
          { productId: balShaktiId, quantity: 1 },
          { productId: matruShaktiId, quantity: 1 },
        ],
      });
    expect(multiOk.status).toBe(201);
    expect(Array.isArray(multiOk.body.data)).toBe(true);
    expect(multiOk.body.data).toHaveLength(2);
  });

  it('Supplier ownership and strict receipt-line validation enforced', async () => {
    // Forging supplierId blocked
    const forged = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        supplierId: gscscId,
        destinationCentreId: vavdiCentreId,
        items: [
          {
            productId: balShaktiId,
            batchNumber: `FORGE-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 10,
          },
        ],
      });
    expect(forged.status).toBe(403);

    // Create legitimate dispatch and test malformed receipt payloads
    const goodDispatch = await request(app)
      .post('/api/dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        destinationCentreId: vavdiCentreId,
        items: [
          {
            productId: balShaktiId,
            batchNumber: `VALID-${Date.now()}`,
            expiryDate: new Date(Date.now() + 60 * 86400000).toISOString(),
            expectedQuantity: 20,
          },
        ],
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
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        decision: 'PARTIAL_APPROVE',
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
      .send({
        destinationCentreId: vavdiCentreId,
        stockRequestId: reqId,
        notes: 'Fulfilling approved Toor Dal request',
        items: [
          {
            productId: dal.id,
            batchNumber: `REQ-DAL-${Date.now()}`,
            expiryDate: new Date(Date.now() + 120 * 86400000).toISOString(),
            expectedQuantity: 20,
          },
        ],
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
