import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { recordAuditLog } from '../lib/audit';

export const authRouter = Router();

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please wait 15 minutes and try again.',
    },
  },
});

const loginSchema = z.object({
  username: z.string().min(2).max(100).trim(),
  password: z.string().min(4).max(128),
  portal: z.enum(['staff', 'beneficiary']).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role, type: 'access' }, env.jwtSecret, {
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

function signRefreshToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role, type: 'refresh' }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions['expiresIn'],
    jwtid: crypto.randomUUID(),
  });
}

const userProfileSelect = {
  id: true,
  name: true,
  nameGu: true,
  username: true,
  email: true,
  role: true,
  centreId: true,
  sectorId: true,
  blockId: true,
  districtId: true,
  supplierId: true,
  centre: {
    select: {
      id: true,
      name: true,
      nameGu: true,
      code: true,
      location: true,
      offlineCredentialSalt: true,
      sector: {
        select: {
          id: true,
          name: true,
          block: {
            select: {
              id: true,
              name: true,
              district: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  sector: { select: { id: true, name: true, blockId: true } },
  block: { select: { id: true, name: true, districtId: true } },
  district: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true, code: true } },
} as const;

async function getUserProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: userProfileSelect,
  });
}

authRouter.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const identifier = parsed.username.toLowerCase();

    // Usernames and emails are stored normalized to lowercase so plain equality
    // hits the @unique B-tree indexes directly without a full-table LOWER() scan.
    const user = identifier.includes('@')
      ? await prisma.user.findFirst({
          where: { OR: [{ email: identifier }, { username: identifier }] },
          select: {
            ...userProfileSelect,
            passwordHash: true,
            isActive: true,
          },
        })
      : await prisma.user.findUnique({
          where: { username: identifier },
          select: {
            ...userProfileSelect,
            passwordHash: true,
            isActive: true,
          },
        });

    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }

    if ((parsed.portal === 'beneficiary' && user.role !== 'BENEFICIARY') || (parsed.portal === 'staff' && user.role === 'BENEFICIARY')) {
      throw new AppError(401, 'WRONG_PORTAL', 'Use the login portal assigned to your account');
    }
    const validPassword = await bcrypt.compare(parsed.password, user.passwordHash);
    if (!validPassword) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const auditPromise = recordAuditLog(prisma, {
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      remarks: `Role ${user.role} signed in`,
    }).catch((err) => console.error('[AuditLog login bg error]', err));

    if (env.isVercel) {
      waitUntil(auditPromise);
    } else if (env.nodeEnv === 'test') {
      await auditPromise;
    }

    const { passwordHash: _ph, isActive: _ia, ...profile } = user;

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: profile,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const decoded = jwt.verify(refreshToken, env.jwtRefreshSecret) as {
      sub: string;
      role: string;
      type: string;
    };

    if (decoded.type !== 'refresh' || !decoded.sub) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, 'TOKEN_REVOKED', 'Refresh token expired or revoked');
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || !user.isActive) {
      throw new AppError(401, 'ACCOUNT_INACTIVE', 'Account inactive');
    }

    // Rotate refresh token
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const newAccessToken = signAccessToken(user.id, user.role);
    const newRefreshToken = signRefreshToken(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(newRefreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(new AppError(401, 'INVALID_REFRESH_TOKEN', 'Unable to refresh session'));
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    await Promise.all([
      token
        ? prisma.refreshToken.updateMany({
            where: { tokenHash: hashToken(token), userId: req.user!.id },
            data: { revokedAt: new Date() },
          })
        : prisma.refreshToken.updateMany({
            where: { userId: req.user!.id, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
      recordAuditLog(prisma, {
        actorId: req.user!.id,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: req.user!.id,
      }),
    ]);

    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user!.id);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});
