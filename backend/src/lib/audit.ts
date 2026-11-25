import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function recordAuditLog(
  db: DbClient,
  params: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: unknown;
    afterState?: unknown;
    remarks?: string;
  }
) {
  await db.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeState:
        params.beforeState !== undefined
          ? (params.beforeState as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      afterState:
        params.afterState !== undefined
          ? (params.afterState as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      remarks: params.remarks ?? null,
    },
  });
}

