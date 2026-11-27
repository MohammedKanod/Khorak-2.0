import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { requireAuth, requireRoles, assertCentreInScope, buildCentreScopeWhere } from '../middleware/auth';
import { formatIstMonth, roundQty } from '../lib/math';
import { recordAuditLog } from '../lib/audit';
export const beneficiaryPortalRouter = Router();
beneficiaryPortalRouter.use(requireAuth);
beneficiaryPortalRouter.get('/accounts', requireRoles(Role.AWW, Role.SUPERVISOR), async (req, res, next) => {
  try {
    const data = await prisma.beneficiaryReference.findMany({ where: { centre: buildCentreScopeWhere(req.user!), status: 'APPROVED', isActive: true }, select: { id: true, displayName: true, localReference: true, centre: { select: { name: true } }, portalAccount: { select: { username: true } } }, orderBy: { displayName: 'asc' } });
    res.json({ success: true, data });
  } catch(e) { next(e); }
});
beneficiaryPortalRouter.post('/accounts', requireRoles(Role.AWW, Role.SUPERVISOR), async (req, res, next) => {
  try {
    const input = z.object({ beneficiaryId: z.string().uuid(), username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{3,39}$/), password: z.string().min(10).max(72) }).parse(req.body);
    const beneficiary = await prisma.beneficiaryReference.findUnique({ where: { id: input.beneficiaryId } });
    if (!beneficiary || !beneficiary.isActive || beneficiary.status !== 'APPROVED') throw new AppError(400, 'VERIFICATION_REQUIRED', 'Choose an approved beneficiary');
    await assertCentreInScope(req.user!, beneficiary.centreId);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.$transaction(async tx => {
      const account = await tx.user.create({ data: { name: beneficiary.displayName, username: input.username, passwordHash, role: Role.BENEFICIARY, beneficiaryId: beneficiary.id } });
      await recordAuditLog(tx, { actorId: req.user!.id, action: 'BENEFICIARY_LOGIN_CREATED', entityType: 'User', entityId: account.id, afterState: { beneficiaryId: beneficiary.id } });
    });
    res.status(201).json({ success: true, data: { created: true } });
  } catch(e) { next(e); }
});
beneficiaryPortalRouter.get('/rations', requireRoles(Role.BENEFICIARY), async (req, res, next) => {
  try {
    const month = formatIstMonth();
    const account = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { beneficiaryId: true } });
    const ids = account?.beneficiaryId ? [account.beneficiaryId] : [];
    const members = await prisma.beneficiaryReference.findMany({ where: { id: { in: ids }, isActive: true, status: 'APPROVED' }, select: { id: true, displayName: true, beneficiaryCategory: true, centre: { select: { name: true, code: true } } } });
    const visibleIds = members.map(m => m.id);
    const [rules, monthly, history] = await Promise.all([
      prisma.entitlementRule.findMany({ include: { product: { select: { id: true, name: true, unit: true } } } }),
      prisma.distribution.groupBy({ by: ['beneficiaryReferenceId', 'productId'], where: { beneficiaryReferenceId: { in: visibleIds }, distributionMonth: month }, _sum: { quantity: true } }),
      prisma.distribution.findMany({ where: { beneficiaryReferenceId: { in: visibleIds }, product: { category: 'THR' } }, select: { id: true, beneficiaryReferenceId: true, quantity: true, distributedAt: true, distributionMonth: true, product: { select: { name: true, unit: true } }, centre: { select: { name: true } } }, orderBy: { distributedAt: 'desc' }, take: 100 }),
    ]);
    const balances = members.map(member => {
      const rule = rules.find(r => r.beneficiaryCategory === member.beneficiaryCategory);
      const received = roundQty(monthly.find(m => m.beneficiaryReferenceId === member.id && m.productId === rule?.productId)?._sum.quantity || 0);
      const limit = rule?.isActive && rule.isConfigured && rule.product ? rule.monthlyLimit : null;
      return { id: member.id, name: member.displayName, centre: member.centre, product: rule?.product || null, monthlyLimit: limit, received, remaining: limit == null ? null : Math.max(0, roundQty(limit - received)), status: rule && !rule.isActive ? 'NO_THR' : limit == null ? 'PENDING_CONFIGURATION' : 'CONFIGURED' };
    });
    res.json({ success: true, data: { month, balances, history, historyLimit: 100 } });
  } catch (err) { next(err); }
});
