import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  nameGu: string | null;
  role: Role;
  centreId: string | null;
  sectorId: string | null;
  blockId: string | null;
  districtId: string | null;
  supplierId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  type: 'access';
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication token required');
    }

    const token = header.slice(7).trim();
    const decoded = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    if (decoded.type !== 'access' || !decoded.sub) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        username: true,
        name: true,
        nameGu: true,
        role: true,
        centreId: true,
        sectorId: true,
        blockId: true,
        districtId: true,
        supplierId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'ACCOUNT_INACTIVE', 'User account is inactive or missing');
    }

    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      nameGu: user.nameGu,
      role: user.role,
      centreId: user.centreId,
      sectorId: user.sectorId,
      blockId: user.blockId,
      districtId: user.districtId,
      supplierId: user.supplierId,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    return next(new AppError(401, 'INVALID_TOKEN', 'Session expired or invalid token'));
  }
}

export function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          403,
          'FORBIDDEN',
          `Role ${req.user.role} is not authorised for this operation`
        )
      );
    }
    return next();
  };
}

export function buildCentreScopeWhere(
  user: AuthenticatedUser
): Prisma.AnganwadiCentreWhereInput {
  switch (user.role) {
    case Role.AWW:
    case Role.AWH:
      return user.centreId ? { id: user.centreId } : { id: '__none__' };
    case Role.SUPERVISOR:
      return user.sectorId ? { sectorId: user.sectorId } : { id: '__none__' };
    case Role.CDPO:
    case Role.TDO:
      return user.blockId ? { sector: { blockId: user.blockId } } : { id: '__none__' };
    case Role.DPO:
    case Role.DDO:
      return user.districtId
        ? { sector: { block: { districtId: user.districtId } } }
        : {};
    case Role.SUPPLIER:
      // Suppliers do not browse arbitrary centre inventories
      return { id: '__none__' };
    default:
      return { id: '__none__' };
  }
}

export async function assertCentreInScope(
  user: AuthenticatedUser,
  centreId: string
) {
  const centre = await prisma.anganwadiCentre.findFirst({
    where: {
      id: centreId,
      ...buildCentreScopeWhere(user),
    },
    include: {
      sector: {
        include: {
          block: {
            include: { district: true },
          },
        },
      },
    },
  });

  if (!centre) {
    throw new AppError(
      403,
      'SCOPE_FORBIDDEN',
      'Centre is outside your authorised organisational scope'
    );
  }
  return centre;
}

