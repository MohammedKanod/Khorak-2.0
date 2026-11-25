import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { classifyReorderLevel } from '../src/services/ledger.service';

const app = createApp();

async function loginAs(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'Khorak@2026' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body.data.accessToken;
}

function computeCredentialHash(last4: string, name: string, yob: string) {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`khorak-uidai-offline-v1|${last4}|${normalizedName}|${yob}`)
    .digest('hex');
}

describe('KHORAK Acceptance & Supply Chain Integrity Tests', () => {
  let awwToken: string;
  let supplierToken: string;
  let supervisorToken: string;
  let ddoToken: string;

  let vavdiCentreId: string;
  let balShaktiId: string;
  let matruShaktiId: string;
  let gcmmflId: string;
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

    const bal = await prisma.product.findUniqueOrThrow({ where: { code: 'THR-BAL' } });
    const mat = await prisma.product.findUniqueOrThrow({ where: { code: 'THR-MAT' } });
    balShaktiId = bal.id;
    matruShaktiId = mat.id;

    const sup = await prisma.supplier.findUniqueOrThrow({ where: { code: 'GCMMFL-PMH' } });
    gcmmflId = sup.id;

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

  it('Test B & C: Verify synthetic Aadhaar Offline XML QR credential, record distribution, and block duplicate submission', async () => {
    // 1. Verify offline credential hash locally derived from Poojaben's synthetic Aadhaar XML
    const hash = computeCredentialHash('4821', 'Poojaben Maheshbhai Bariya', '1997');
    const verifyRes = await request(app)
      .post('/api/beneficiaries/verify-offline-credential')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({ protectedCredentialReference: hash });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.beneficiary.id).toBe(beneficiaryPoojaId);

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

  it('Test J: AWW adds beneficiary (PENDING_APPROVAL), blocked until Sevika approves, then distributes', async () => {
    const createRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${awwToken}`)
      .send({
        displayName: 'Rekhaben Naranbhai Solanki',
        displayNameGu: 'રેખાબેન નારણભાઈ સોલંકી',
        maskedIdLast4: '5519',
        yob: '2000',
        beneficiaryCategory: 'LACTATING_MOTHER',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('PENDING_APPROVAL');
    const newBenId = createRes.body.data.id;
    const credHash = computeCredentialHash('5519', 'Rekhaben Naranbhai Solanki', '2000');

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
});
