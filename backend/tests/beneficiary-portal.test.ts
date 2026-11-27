import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { formatIstMonth } from '../src/lib/math';
const app = createApp();
const username = `beneficiary.test.${crypto.randomBytes(4).toString('hex')}`;
const password = 'BeneficiaryTest@2026';
let worker: string, token: string, beneficiaryId: string, outsiderId: string;
const auth = (t: string) => `Bearer ${t}`;
beforeAll(async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'aww.vavdi', password: 'Khorak@2026', portal: 'staff' });
  worker = login.body.data.accessToken;
  const centreId = login.body.data.user.centreId;
  beneficiaryId = (await prisma.beneficiaryReference.findFirstOrThrow({ where: { centreId, status: 'APPROVED', isActive: true } })).id;
  outsiderId = (await prisma.beneficiaryReference.findFirstOrThrow({ where: { centreId: { not: centreId }, status: 'APPROVED', isActive: true } })).id;
});
afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { username } });
  if (user) { await prisma.refreshToken.deleteMany({ where: { userId: user.id } }); await prisma.auditLog.deleteMany({ where: { entityId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); }
});
describe('Personal beneficiary portal', () => {
  it('removes public registration and support requests', async () => {
    expect((await request(app).post('/api/auth/guardian-register').set('Authorization', auth(worker)).send({})).status).toBe(404);
    expect((await request(app).get('/api/guardian/requests').set('Authorization', auth(worker))).status).toBe(404);
  });
  it('only scoped staff can provision an approved personal beneficiary account', async () => {
    const denied = await request(app).post('/api/beneficiary-portal/accounts').set('Authorization', auth(worker)).send({ beneficiaryId: outsiderId, username, password });
    expect(denied.status).toBe(403);
    const created = await request(app).post('/api/beneficiary-portal/accounts').set('Authorization', auth(worker)).send({ beneficiaryId, username, password });
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ username, password, portal: 'beneficiary' });
    expect(login.status).toBe(200); token = login.body.data.accessToken;
    expect((await request(app).post('/api/auth/login').send({ username, password, portal: 'staff' })).status).toBe(401);
  });
  it('returns only personal THR history and the correct current month balance, ignoring supplied IDs', async () => {
    const result = await request(app).get(`/api/beneficiary-portal/rations?beneficiaryId=${outsiderId}`).set('Authorization', auth(token));
    expect(result.status).toBe(200);
    expect(result.body.data.month).toBe(formatIstMonth());
    expect(result.body.data.balances).toHaveLength(1);
    expect(result.body.data.balances[0].id).toBe(beneficiaryId);
    expect(result.body.data.history.every((h: { beneficiaryReferenceId: string }) => h.beneficiaryReferenceId === beneficiaryId)).toBe(true);
    const b = result.body.data.balances[0];
    const beneficiary = await prisma.beneficiaryReference.findUniqueOrThrow({ where: { id: beneficiaryId } });
    const rule = await prisma.entitlementRule.findUnique({ where: { beneficiaryCategory: beneficiary.beneficiaryCategory } });
    const sum = await prisma.distribution.aggregate({ where: { beneficiaryReferenceId: beneficiaryId, productId: rule?.productId || '__none__', distributionMonth: formatIstMonth() }, _sum: { quantity: true } });
    expect(b.received).toBe(sum._sum.quantity || 0);
    if (b.monthlyLimit !== null) expect(b.remaining).toBe(Math.max(0, b.monthlyLimit - b.received));
    expect(JSON.stringify(result.body)).not.toMatch(/passwordHash|protectedCredentialReference|maskedIdLast4|offlineCredentialSalt/);
  });
  it('denies all staff data and all non-auth mutations', async () => {
    for (const path of ['/api/beneficiaries', '/api/dashboard/admin-bundle', '/api/beneficiary-portal/accounts', '/api/stock-requests']) expect((await request(app).get(path).set('Authorization', auth(token))).status).toBe(403);
    expect((await request(app).post('/api/beneficiary-portal/accounts').set('Authorization', auth(token)).send({})).status).toBe(403);
  });
  it('hides records after the linked beneficiary is deactivated', async () => {
    await prisma.beneficiaryReference.update({ where: { id: beneficiaryId }, data: { isActive: false } });
    try { const result = await request(app).get('/api/beneficiary-portal/rations').set('Authorization', auth(token)); expect(result.body.data.balances).toEqual([]); expect(result.body.data.history).toEqual([]); }
    finally { await prisma.beneficiaryReference.update({ where: { id: beneficiaryId }, data: { isActive: true } }); }
  });
});
