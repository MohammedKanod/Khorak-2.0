import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { requireAuth, requireRoles, assertCentreInScope, buildCentreScopeWhere } from '../middleware/auth';
import { recordAuditLog } from '../lib/audit';

export const guardianRouter = Router();
guardianRouter.use(requireAuth);
const allowed = [Role.GUARDIAN, Role.AWW, Role.SUPERVISOR, Role.CDPO];
const centreSelect = { id: true, name: true, nameGu: true, code: true, location: true, sector: { select: { name: true, block: { select: { name: true } } } } } as const;

guardianRouter.get('/centres', requireRoles(Role.GUARDIAN), async (_req, res, next) => {
  try {
    // Public service directory only: no stock, staff identities or beneficiary data.
    const centres = await prisma.anganwadiCentre.findMany({ where: { isActive: true }, select: centreSelect, orderBy: { name: 'asc' } });
    res.json({ success: true, data: centres });
  } catch (err) { next(err); }
});

guardianRouter.get('/requests', requireRoles(...allowed), async (req, res, next) => {
  try {
    const rows = await prisma.guardianRequest.findMany({
      where: req.user!.role === Role.GUARDIAN ? { guardianId: req.user!.id } : { centre: buildCentreScopeWhere(req.user!) },
      include: { centre: { select: centreSelect }, guardian: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

guardianRouter.post('/requests', requireRoles(Role.GUARDIAN), async (req, res, next) => {
  try {
    const input = z.object({ centreId: z.string().uuid(), beneficiaryName: z.string().trim().min(2).max(100), birthYear: z.coerce.number().int().min(1900).max(new Date().getFullYear()), category: z.enum(['CHILD_6M_3Y', 'CHILD_3Y_6Y', 'PREGNANT_WOMAN', 'LACTATING_MOTHER']), message: z.string().trim().max(500).optional(), idempotencyKey: z.string().uuid() }).parse(req.body);
    const centre = await prisma.anganwadiCentre.findFirst({ where: { id: input.centreId, isActive: true } });
    if (!centre) throw new AppError(400, 'CENTRE_UNAVAILABLE', 'Choose an active Anganwadi centre');
    const existing = await prisma.guardianRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.guardianId !== req.user!.id) throw new AppError(409, 'REQUEST_CONFLICT', 'Please start a new request');
      return res.json({ success: true, data: existing });
    }
    const openRequest = await prisma.guardianRequest.findFirst({ where: { guardianId: req.user!.id, centreId: input.centreId, beneficiaryName: input.beneficiaryName, category: input.category, status: { in: ['PENDING', 'NEEDS_INFO', 'APPROVED'] } } });
    if (openRequest) throw new AppError(409, 'REQUEST_EXISTS', 'An active request already exists for this person at this centre. Track it under My requests.');
    const row = await prisma.guardianRequest.create({ data: { ...input, guardianId: req.user!.id, reference: `FAM-${crypto.randomBytes(4).toString('hex').toUpperCase()}` } });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
});

guardianRouter.post('/requests/:id/review', requireRoles(Role.AWW, Role.SUPERVISOR), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['NEEDS_INFO', 'APPROVED', 'DECLINED']), remarks: z.string().trim().min(5).max(1000) }).parse(req.body);
    const row = await prisma.guardianRequest.findUnique({ where: { id: String(req.params.id) } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    await assertCentreInScope(req.user!, row.centreId);
    if (!['PENDING', 'NEEDS_INFO'].includes(row.status)) throw new AppError(409, 'ALREADY_REVIEWED', 'This request has already been decided');
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.guardianRequest.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, status: row.status }, data: { status: input.status, reviewRemarks: input.remarks, reviewedBy: req.user!.id, reviewedAt: new Date() } });
      if (changed.count !== 1) throw new AppError(409, 'REVIEW_CONFLICT', 'Another officer updated this request. Refresh and review again.');
      await recordAuditLog(tx, { actorId: req.user!.id, action: 'GUARDIAN_REQUEST_REVIEWED', entityType: 'GuardianRequest', entityId: row.id, beforeState: { status: row.status }, afterState: { status: input.status }, remarks: input.remarks });
      return tx.guardianRequest.findUnique({ where: { id: row.id } });
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

guardianRouter.post('/requests/:id/respond', requireRoles(Role.GUARDIAN), async (req, res, next) => {
  try {
    const { message } = z.object({ message: z.string().trim().min(5).max(500) }).parse(req.body);
    const result = await prisma.guardianRequest.updateMany({ where: { id: String(req.params.id), guardianId: req.user!.id, status: 'NEEDS_INFO' }, data: { message, status: 'PENDING' } });
    if (result.count !== 1) throw new AppError(404, 'NOT_FOUND', 'No request awaiting your response');
    res.json({ success: true, data: { updated: true } });
  } catch (err) { next(err); }
});
