import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { requireAuth, requireRoles, assertCentreInScope, buildCentreScopeWhere } from '../middleware/auth';
import { recordAuditLog } from '../lib/audit';

export const governanceRouter = Router();
governanceRouter.use(requireAuth);

governanceRouter.get('/notes', requireRoles(Role.AWW, Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.TDO, Role.DDO), async (req, res, next) => {
  try {
    const rows = await prisma.operationalNote.findMany({
      where: { centre: buildCentreScopeWhere(req.user!), ...(req.user!.role === Role.AWW ? { authorId: req.user!.id } : {}) },
      include: { centre: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

governanceRouter.post('/notes', requireRoles(Role.AWW, Role.SUPERVISOR, Role.CDPO), async (req, res, next) => {
  try {
    const input = z.object({ centreId: z.string().uuid(), kind: z.enum(['INSPECTION', 'SHORTAGE', 'ANOMALY']), message: z.string().trim().min(10).max(2000) }).parse(req.body);
    await assertCentreInScope(req.user!, input.centreId);
    if ((input.kind === 'INSPECTION' && req.user!.role !== Role.SUPERVISOR) ||
        (input.kind === 'ANOMALY' && req.user!.role !== Role.CDPO) ||
        (req.user!.role === Role.AWW && input.kind !== 'SHORTAGE')) {
      throw new AppError(403, 'FORBIDDEN', 'This note type is not available to your role');
    }
    const row = await prisma.$transaction(async (tx) => {
      const note = await tx.operationalNote.create({ data: { ...input, authorId: req.user!.id, authorName: req.user!.name, authorRole: req.user!.role } });
      await recordAuditLog(tx, { actorId: req.user!.id, action: 'OPERATIONAL_NOTE_CREATED', entityType: 'OperationalNote', entityId: note.id, remarks: input.message });
      return note;
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
});

governanceRouter.get('/suppliers', requireRoles(Role.CDPO, Role.SUPERVISOR, Role.DPO, Role.TDO, Role.DDO), async (req, res, next) => {
  try {
    const user = req.user!;
    // Restrict directory to blocks reachable from the user's centre scope.
    const centres = await prisma.anganwadiCentre.findMany({ where: buildCentreScopeWhere(user), select: { sector: { select: { blockId: true } } } });
    const blocks = [...new Set(centres.map(c => c.sector.blockId))];
    const rows = await prisma.blockSupplier.findMany({ where: { blockId: { in: blocks } }, include: { supplier: { select: { id: true, name: true, code: true } }, block: { select: { name: true } } }, orderBy: { supplier: { name: 'asc' } } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

governanceRouter.post('/suppliers', requireRoles(Role.CDPO), async (req, res, next) => {
  try {
    if (!req.user!.blockId) throw new AppError(403, 'SCOPE_FORBIDDEN', 'Block assignment required');
    const input = z.object({ name: z.string().trim().min(3).max(150), code: z.string().trim().min(3).max(40), contactInformation: z.string().trim().min(3).max(500) }).parse(req.body);
    const row = await prisma.$transaction(async tx => {
      // Existing suppliers retain their shared identity; contacts are local to this block.
      const supplier = await tx.supplier.upsert({ where: { code: input.code }, create: input, update: {} });
      const profile = await tx.blockSupplier.upsert({ where: { blockId_supplierId: { blockId: req.user!.blockId!, supplierId: supplier.id } }, create: { blockId: req.user!.blockId!, supplierId: supplier.id, contactInformation: input.contactInformation }, update: { contactInformation: input.contactInformation, isActive: true } });
      await recordAuditLog(tx, { actorId: req.user!.id, action: 'BLOCK_SUPPLIER_SAVED', entityType: 'BlockSupplier', entityId: profile.id, afterState: { contactInformation: profile.contactInformation, blockId: profile.blockId } });
      return profile;
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
});

governanceRouter.patch('/suppliers/:id', requireRoles(Role.CDPO), async (req, res, next) => {
  try {
    const input = z.object({ contactInformation: z.string().trim().min(3).max(500), isActive: z.boolean() }).parse(req.body);
    const row = await prisma.blockSupplier.findFirst({ where: { id: String(req.params.id), blockId: req.user!.blockId ?? '__none__' } });
    if (!row) throw new AppError(403, 'SCOPE_FORBIDDEN', 'Supplier record is outside your block');
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.blockSupplier.update({ where: { id: row.id }, data: input });
      await recordAuditLog(tx, { actorId: req.user!.id, action: 'BLOCK_SUPPLIER_UPDATED', entityType: 'BlockSupplier', entityId: row.id, beforeState: { contactInformation: row.contactInformation, isActive: row.isActive }, afterState: input });
      return updated;
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Full month ledger report, bounded by role scope and IST calendar boundaries.
governanceRouter.get('/reports/monthly', requireRoles(Role.SUPERVISOR, Role.CDPO, Role.DPO, Role.TDO, Role.DDO), async (req, res, next) => {
  try {
    const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).parse(req.query.month);
    const [year, number] = month.split('-').map(Number);
    const from = new Date(`${month}-01T00:00:00+05:30`);
    const to = new Date(Date.UTC(year, number, 1) - 330 * 60_000);
    const rows = await prisma.stockLedgerEvent.findMany({
      where: { centre: buildCentreScopeWhere(req.user!), createdAt: { gte: from, lt: to } },
      select: { quantity: true, eventType: true, centre: { select: { code: true, name: true, sector: { select: { name: true, block: { select: { name: true } } } } } }, product: { select: { code: true, name: true, unit: true } } },
    });
    const groups = new Map<string, { centreCode: string; centre: string; sector: string; block: string; product: string; unit: string; event: string; quantity: number; records: number }>();
    for (const row of rows) {
      const key = `${row.centre.code}:${row.product.code}:${row.eventType}`;
      const entry = groups.get(key) ?? { centreCode: row.centre.code, centre: row.centre.name, sector: row.centre.sector.name, block: row.centre.sector.block.name, product: row.product.name, unit: row.product.unit, event: row.eventType, quantity: 0, records: 0 };
      entry.quantity = Math.round((entry.quantity + row.quantity) * 1000) / 1000;
      entry.records++;
      groups.set(key, entry);
    }
    res.json({ success: true, data: { month, timezone: 'Asia/Kolkata', rows: [...groups.values()] } });
  } catch (err) { next(err); }
});
