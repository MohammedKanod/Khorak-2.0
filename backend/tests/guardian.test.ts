import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
const app = createApp();
const suffix = crypto.randomBytes(4).toString('hex');
const guardianName = `guardian.test.${suffix}`;
const secondName = `guardian.other.${suffix}`;
const password = 'FamilyTest@2026';
let token: string; let otherToken: string; let workerToken: string; let centreId: string; let otherCentreId: string; let requestId: string;
const header = (value: string) => `Bearer ${value}`;
async function login(username: string, pass = password, portal = 'guardian') {
  const result = await request(app).post('/api/auth/login').send({ username, password: pass, portal });
  expect(result.status).toBe(200); return result.body.data.accessToken as string;
}
beforeAll(async () => {
  for (const username of [guardianName, secondName]) {
    const result = await request(app).post('/api/auth/guardian-register').send({ name: 'Synthetic guardian', username, password, role: 'DPO' });
    expect(result.status).toBe(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { username } })).role).toBe('GUARDIAN');
  }
  token = await login(guardianName); otherToken = await login(secondName);
  workerToken = await login('aww.vavdi', 'Khorak@2026', 'staff');
  centreId = (await prisma.user.findUniqueOrThrow({ where: { username: 'aww.vavdi' } })).centreId!;
  otherCentreId = (await prisma.anganwadiCentre.findFirstOrThrow({ where: { id: { not: centreId } } })).id;
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { username: { in: [guardianName, secondName] } } });
  const ids = users.map(u => u.id);
  await prisma.guardianRequest.deleteMany({ where: { guardianId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});
describe('Guardian request journey and privacy', () => {
  it('blocks staff data and enforces the selected login portal', async () => {
    for (const path of ['/api/beneficiaries', '/api/dashboard/admin-bundle', `/api/inventory/${centreId}`, '/api/stock-requests']) {
      expect((await request(app).get(path).set('Authorization', header(token))).status).toBe(403);
    }
    expect((await request(app).post('/api/auth/login').send({ username: guardianName, password, portal: 'staff' })).status).toBe(401);
    const directory = await request(app).get('/api/guardian/centres').set('Authorization', header(token));
    expect(directory.status).toBe(200);
    expect(directory.body.data[0]).not.toHaveProperty('offlineCredentialSalt');
  });
  it('submits a request idempotently and only its owner and scoped staff can see it', async () => {
    const body = { centreId, beneficiaryName: `Demo Child ${suffix}`, birthYear: 2023, category: 'CHILD_3Y_6Y', message: 'Synthetic test request', idempotencyKey: crypto.randomUUID() };
    const result = await request(app).post('/api/guardian/requests').set('Authorization', header(token)).send(body);
    expect(result.status).toBe(201); requestId = result.body.data.id;
    const retry = await request(app).post('/api/guardian/requests').set('Authorization', header(token)).send(body);
    expect(retry.body.data.id).toBe(requestId);
    const other = await request(app).get('/api/guardian/requests').set('Authorization', header(otherToken));
    expect(other.body.data).toEqual([]);
    const inbox = await request(app).get('/api/guardian/requests').set('Authorization', header(workerToken));
    expect(inbox.body.data.some((r: { id: string }) => r.id === requestId)).toBe(true);
  });
  it('staff requests more information; guardian responds; staff invites family without issuing stock', async () => {
    const before = await prisma.stockLedgerEvent.count();
    const review = await request(app).post(`/api/guardian/requests/${requestId}/review`).set('Authorization', header(workerToken)).send({ status: 'NEEDS_INFO', remarks: 'Please tell us a convenient time to visit.' });
    expect(review.status).toBe(200);
    expect((await request(app).post(`/api/guardian/requests/${requestId}/respond`).set('Authorization', header(otherToken)).send({ message: 'Not my request' })).status).toBe(404);
    expect((await request(app).post(`/api/guardian/requests/${requestId}/respond`).set('Authorization', header(token)).send({ message: 'We can visit tomorrow morning.' })).status).toBe(200);
    expect((await request(app).post(`/api/guardian/requests/${requestId}/review`).set('Authorization', header(workerToken)).send({ status: 'APPROVED', remarks: 'Visit the centre tomorrow morning for verification.' })).status).toBe(200);
    const mine = await request(app).get('/api/guardian/requests').set('Authorization', header(token));
    expect(mine.body.data.find((r: { id: string }) => r.id === requestId).status).toBe('APPROVED');
    // Assert no stock event is linked to this request; concurrent acceptance tests may add unrelated events.
    expect(await prisma.stockLedgerEvent.count({ where: { referenceId: requestId } })).toBe(0);
    expect(await prisma.stockLedgerEvent.count()).toBeGreaterThanOrEqual(before);
  });
  it('workers cannot review requests belonging to another centre', async () => {
    const result = await request(app).post('/api/guardian/requests').set('Authorization', header(token)).send({ centreId: otherCentreId, beneficiaryName: `Other Child ${suffix}`, birthYear: 2024, category: 'CHILD_6M_3Y', idempotencyKey: crypto.randomUUID() });
    expect(result.status).toBe(201);
    const denied = await request(app).post(`/api/guardian/requests/${result.body.data.id}/review`).set('Authorization', header(workerToken)).send({ status: 'APPROVED', remarks: 'Should not be allowed' });
    expect(denied.status).toBe(403);
  });
});
