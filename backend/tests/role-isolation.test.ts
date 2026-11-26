import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertCentreInScope, buildCentreScopeWhere, AuthenticatedUser } from '../src/middleware/auth';
import { Role } from '@prisma/client';
const app = createApp();
const tokens: Record<string, string> = {};
let centreId: string;
let otherCentreId: string;
let otherBlockId: string;
let productId: string;
let supplierId: string;
let cdpo: AuthenticatedUser;

beforeAll(async () => {
  for (const username of ['aww.vavdi', 'awh.vavdi', 'sup.godhra', 'cdpo.godhra', 'tdo.godhra', 'dpo.panchmahal', 'ddo.panchmahal', 'supplier.gcmmfl']) {
    const result = await request(app).post('/api/auth/login').send({ username, password: 'Khorak@2026' });
    expect(result.status).toBe(200);
    tokens[username] = result.body.data.accessToken;
  }
  const worker = await prisma.user.findUniqueOrThrow({ where: { username: 'aww.vavdi' } });
  centreId = worker.centreId!;
  cdpo = await prisma.user.findUniqueOrThrow({ where: { username: 'cdpo.godhra' } });
  const other = await prisma.anganwadiCentre.findFirstOrThrow({ where: { sector: { blockId: { not: cdpo.blockId! } } }, include: { sector: true } });
  otherCentreId = other.id; otherBlockId = other.sector.blockId;
  productId = (await prisma.product.findFirstOrThrow()).id;
  supplierId = (await prisma.supplier.findUniqueOrThrow({ where: { code: 'GCMMFL-PMH' } })).id;
});
const auth = (username: string) => `Bearer ${tokens[username]}`;

describe('Hierarchy isolation and role capabilities', () => {
  it.each(['awh.vavdi', 'dpo.panchmahal', 'tdo.godhra', 'ddo.panchmahal'])('%s cannot write through normal or offline endpoints', async username => {
    for (const path of ['/api/sync/push', '/api/stock-requests', '/api/approvals/approve', '/api/governance/notes', '/api/distributions']) {
      const result = await request(app).post(path).set('Authorization', auth(username)).send({});
      expect(result.status).toBe(403); expect(result.body.error.code).toBe('READ_ONLY_ROLE');
    }
  });
  it('AWH can view own stock but cannot read beneficiary data or the sync snapshot', async () => {
    expect((await request(app).get(`/api/inventory/${centreId}`).set('Authorization', auth('awh.vavdi'))).status).toBe(200);
    for (const path of ['/api/beneficiaries', `/api/sync/pull?centreId=${centreId}`, '/api/dispatches', '/api/inventory/spoilage', '/api/inventory/reconciliations', `/api/inventory/${otherCentreId}`]) {
      expect((await request(app).get(path).set('Authorization', auth('awh.vavdi'))).status).toBe(403);
    }
  });
  it('AWW cannot override own-centre scope with a query or path parameter', async () => {
    const result = await request(app).get(`/api/inventory?centreId=${otherCentreId}`).set('Authorization', auth('aww.vavdi'));
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('SCOPE_FORBIDDEN');
    expect((await request(app).get(`/api/inventory/${otherCentreId}`).set('Authorization', auth('aww.vavdi'))).status).toBe(403);
  });
  it('CDPO and supervisor cannot inspect another block', async () => {
    for (const username of ['cdpo.godhra', 'sup.godhra']) {
      expect((await request(app).get(`/api/inventory/${otherCentreId}`).set('Authorization', auth(username))).status).toBe(403);
    }
  });
  it('district accounts without a scope fail closed and requested blocks cannot replace district scope', async () => {
    const noScope = { ...cdpo, role: Role.DPO, districtId: null };
    expect(buildCentreScopeWhere(noScope)).toEqual({ id: '__none__' });
    const outsider = { ...cdpo, role: Role.DPO, districtId: crypto.randomUUID() };
    await expect(assertCentreInScope(outsider, centreId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('block dashboards only return the assigned block and are not cacheable', async () => {
    const result = await request(app).get(`/api/dashboard/block?blockId=${otherBlockId}`).set('Authorization', auth('cdpo.godhra'));
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.body.data.centres.every((c: { blockId: string }) => c.blockId === cdpo.blockId)).toBe(true);
  });
  it('supervisor inspection reaches the DPO without relogin; outsider notes are denied', async () => {
    const marker = `Verification inspection ${crypto.randomUUID()}`;
    const saved = await request(app).post('/api/governance/notes').set('Authorization', auth('sup.godhra')).send({ centreId, kind: 'INSPECTION', message: marker });
    expect(saved.status).toBe(201);
    const visible = await request(app).get('/api/governance/notes').set('Authorization', auth('dpo.panchmahal'));
    expect(visible.body.data.some((n: { message: string }) => n.message === marker)).toBe(true);
    const denied = await request(app).post('/api/governance/notes').set('Authorization', auth('sup.godhra')).send({ centreId: otherCentreId, kind: 'INSPECTION', message: marker });
    expect(denied.status).toBe(403);
    await prisma.operationalNote.delete({ where: { id: saved.body.data.id } });
  });
  it('CDPO issues an assigned stock order; supplier sees it immediately; other suppliers cannot', async () => {
    const order = await request(app).post('/api/stock-requests').set('Authorization', auth('cdpo.godhra')).send({ centreId, productId, assignedSupplierId: supplierId, requestedQuantity: 5, reason: 'EXPECTED_DEMAND', remarks: 'Integration test stock order', idempotencyKey: crypto.randomUUID() });
    expect(order.status).toBe(201); expect(order.body.data.status).toBe('APPROVED');
    const list = await request(app).get('/api/stock-requests').set('Authorization', auth('supplier.gcmmfl'));
    expect(list.body.data.some((r: { id: string }) => r.id === order.body.data.id)).toBe(true);
    const detail = await request(app).get(`/api/stock-requests/${order.body.data.id}`).set('Authorization', auth('supplier.gcmmfl'));
    expect(detail.body.data.currentCentreProductStock).toBeNull();
    const otherSupplier = await prisma.supplier.findFirstOrThrow({ where: { id: { not: supplierId } } });
    await prisma.stockRequest.update({ where: { id: order.body.data.id }, data: { assignedSupplierId: otherSupplier.id } });
    expect((await request(app).get(`/api/stock-requests/${order.body.data.id}`).set('Authorization', auth('supplier.gcmmfl'))).status).toBe(403);
    await prisma.stockRequestHistory.deleteMany({ where: { stockRequestId: order.body.data.id } });
    await prisma.stockRequest.delete({ where: { id: order.body.data.id } });
  });
  it('monthly reports validate month and obey the same block boundary', async () => {
    expect((await request(app).get('/api/governance/reports/monthly?month=2026-99').set('Authorization', auth('cdpo.godhra'))).status).toBe(400);
    const report = await request(app).get('/api/governance/reports/monthly?month=2026-11').set('Authorization', auth('cdpo.godhra'));
    expect(report.status).toBe(200);
    expect(report.body.data.timezone).toBe('Asia/Kolkata');
    expect(report.body.data.rows.every((r: { block: string }) => r.block === 'Godhra')).toBe(true);
  });
});
