import { Router } from 'express';
import { z } from 'zod';
import {
  DiscrepancyStatus,
  DispatchStatus,
  LedgerEventType,
  Role,
  SpoilageStatus,
  SyncStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { assertCentreInScope, requireAuth, requireRoles } from '../middleware/auth';
import { executeDistribution } from './distribution.routes';
import {
  allocateFefoBatches,
  getCentreBatchBalances,
  getCentreInventorySummary,
} from '../services/ledger.service';
import { refreshCentreAlerts } from '../services/alert.service';
import { recordAuditLog } from '../lib/audit';
import { roundQty } from '../lib/math';

export const syncRouter = Router();

syncRouter.use(requireAuth);

const syncItemSchema = z.object({
  operationUuid: z.string().min(8).max(120),
  operationType: z.enum([
    'DISTRIBUTION',
    'CONSUMPTION',
    'SPOILAGE',
    'RECEIVE_DISPATCH',
  ]),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const syncPushSchema = z.object({
  operations: z.array(syncItemSchema).min(1).max(100),
});

syncRouter.post(
  '/push',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const parsed = syncPushSchema.parse(req.body);
      const results: Array<{
        operationUuid: string;
        status: 'SYNCED' | 'FAILED' | 'CONFLICT';
        deduplicated?: boolean;
        message?: string;
        data?: unknown;
      }> = [];

      for (const op of parsed.operations) {
        const existingSync = await prisma.syncOperation.findUnique({
          where: { operationUuid: op.operationUuid },
        });

        if (existingSync && existingSync.status === SyncStatus.SYNCED) {
          results.push({
            operationUuid: op.operationUuid,
            status: 'SYNCED',
            deduplicated: true,
            message: 'Already synchronised earlier',
          });
          continue;
        }

        try {
          let resultData: unknown = null;
          let centreIdForSync: string | null = req.user!.centreId;

          if (op.operationType === 'DISTRIBUTION') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                beneficiaryReferenceId: z.string().uuid(),
                productId: z.string().uuid(),
                batchId: z.string().uuid().optional(),
                quantity: z.coerce.number().positive(),
                distributedAt: z.string().optional(),
                remarks: z.string().optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            const exec = await executeDistribution({
              userId: req.user!.id,
              centreId: targetCentreId,
              beneficiaryReferenceId: p.beneficiaryReferenceId,
              productId: p.productId,
              batchId: p.batchId,
              quantity: p.quantity,
              distributedAt: p.distributedAt ? new Date(p.distributedAt) : new Date(op.createdAt),
              idempotencyKey: op.operationUuid,
              remarks: p.remarks,
            });
            resultData = exec.distribution;
          } else if (op.operationType === 'CONSUMPTION') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                productId: z.string().uuid(),
                batchId: z.string().uuid().optional(),
                quantity: z.coerce.number().positive(),
                remarks: z.string().optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            const existingEv = await prisma.stockLedgerEvent.findFirst({
              where: { idempotencyKey: { startsWith: op.operationUuid } },
            });
            if (existingEv) {
              resultData = existingEv;
            } else {
              resultData = await prisma.$transaction(async (tx) => {
                const allocations = await allocateFefoBatches(tx, {
                  centreId: targetCentreId,
                  productId: p.productId,
                  quantity: p.quantity,
                  preferredBatchId: p.batchId,
                });
                const created = [];
                for (let idx = 0; idx < allocations.length; idx++) {
                  const alloc = allocations[idx];
                  created.push(
                    await tx.stockLedgerEvent.create({
                      data: {
                        centreId: targetCentreId,
                        productId: p.productId,
                        batchId: alloc.batchId,
                        eventType: LedgerEventType.CONSUMED,
                        quantity: alloc.quantity,
                        referenceType: 'OFFLINE_CONSUMPTION',
                        remarks: p.remarks || `Offline usage from batch ${alloc.batchNumber}`,
                        idempotencyKey:
                          allocations.length === 1 ? op.operationUuid : `${op.operationUuid}-${idx}`,
                        createdBy: req.user!.id,
                      },
                    })
                  );
                }
                return created;
              });
              await refreshCentreAlerts(targetCentreId);
            }
          } else if (op.operationType === 'SPOILAGE') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                productId: z.string().uuid(),
                batchId: z.string().uuid(),
                quantity: z.coerce.number().positive(),
                reason: z.string().min(3),
                remarks: z.string().optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            const existingSpoil = await prisma.spoilageReport.findUnique({
              where: { idempotencyKey: op.operationUuid },
            });
            if (existingSpoil) {
              resultData = existingSpoil;
            } else {
              const batches = await getCentreBatchBalances(targetCentreId, prisma, {
                productId: p.productId,
                includeZero: true,
              });
              const targetBatch = batches.find((b) => b.batchId === p.batchId);
              if (!targetBatch || targetBatch.balance < roundQty(p.quantity)) {
                throw new AppError(409, 'INSUFFICIENT_STOCK', 'Batch balance is insufficient for spoilage report');
              }

              resultData = await prisma.spoilageReport.create({
                data: {
                  centreId: targetCentreId,
                  productId: p.productId,
                  batchId: p.batchId,
                  quantity: roundQty(p.quantity),
                  reason: p.reason,
                  remarks: p.remarks,
                  status: SpoilageStatus.PENDING,
                  reportedBy: req.user!.id,
                  idempotencyKey: op.operationUuid,
                },
              });
              await refreshCentreAlerts(targetCentreId);
            }
          } else if (op.operationType === 'RECEIVE_DISPATCH') {
            const p = z
              .object({
                dispatchId: z.string().uuid(),
                notes: z.string().optional(),
                items: z.array(
                  z.object({
                    productId: z.string().uuid(),
                    batchId: z.string().uuid(),
                    acceptedQuantity: z.coerce.number().min(0),
                    damagedQuantity: z.coerce.number().min(0).default(0),
                    missingQuantity: z.coerce.number().min(0).optional(),
                  })
                ),
              })
              .parse(op.payload);

            const dispatch = await prisma.dispatch.findUnique({
              where: { id: p.dispatchId },
              include: { items: true, deliveryReceipt: true },
            });
            if (!dispatch) throw new AppError(404, 'NOT_FOUND', 'Dispatch not found');
            centreIdForSync = dispatch.destinationCentreId;
            await assertCentreInScope(req.user!, dispatch.destinationCentreId);

            if (dispatch.deliveryReceipt) {
              if (dispatch.deliveryReceipt.idempotencyKey === op.operationUuid) {
                resultData = dispatch.deliveryReceipt;
              } else {
                throw new AppError(409, 'ALREADY_RECEIVED', 'Dispatch was already received on server');
              }
            } else {
              let totalExpected = 0;
              let totalAccepted = 0;
              let totalDamaged = 0;
              let totalMissing = 0;
              const itemsData: Array<{
                productId: string;
                batchId: string;
                expectedQuantity: number;
                acceptedQuantity: number;
                damagedQuantity: number;
                missingQuantity: number;
              }> = [];

              for (const dItem of dispatch.items) {
                const m = p.items.find(
                  (i) => i.productId === dItem.productId && i.batchId === dItem.batchId
                );
                if (!m) throw new AppError(400, 'MISSING_ITEM_RECEIPT', 'Incomplete items');
                const exp = roundQty(dItem.expectedQuantity);
                const acc = roundQty(m.acceptedQuantity);
                const dmg = roundQty(m.damagedQuantity);
                const miss =
                  m.missingQuantity !== undefined
                    ? roundQty(m.missingQuantity)
                    : roundQty(Math.max(0, exp - acc - dmg));
                if (roundQty(acc + dmg + miss) !== exp) {
                  throw new AppError(400, 'QUANTITY_MISMATCH', 'Accepted + damaged + missing != expected');
                }
                totalExpected = roundQty(totalExpected + exp);
                totalAccepted = roundQty(totalAccepted + acc);
                totalDamaged = roundQty(totalDamaged + dmg);
                totalMissing = roundQty(totalMissing + miss);
                itemsData.push({
                  productId: dItem.productId,
                  batchId: dItem.batchId,
                  expectedQuantity: exp,
                  acceptedQuantity: acc,
                  damagedQuantity: dmg,
                  missingQuantity: miss,
                });
              }

              const hasDiscrepancy = totalAccepted !== totalExpected;
              resultData = await prisma.$transaction(async (tx) => {
                const receipt = await tx.deliveryReceipt.create({
                  data: {
                    dispatchId: dispatch.id,
                    expectedQuantity: totalExpected,
                    acceptedQuantity: totalAccepted,
                    damagedQuantity: totalDamaged,
                    missingQuantity: totalMissing,
                    notes: p.notes,
                    receivedBy: req.user!.id,
                    idempotencyKey: op.operationUuid,
                    items: { create: itemsData },
                  },
                });
                for (let idx = 0; idx < itemsData.length; idx++) {
                  const it = itemsData[idx];
                  if (it.acceptedQuantity > 0) {
                    await tx.stockLedgerEvent.create({
                      data: {
                        centreId: dispatch.destinationCentreId,
                        productId: it.productId,
                        batchId: it.batchId,
                        eventType: LedgerEventType.RECEIVED,
                        quantity: it.acceptedQuantity,
                        referenceId: receipt.id,
                        referenceType: 'DELIVERY_RECEIPT',
                        remarks: `Offline sync receipt for ${dispatch.dispatchReference}`,
                        idempotencyKey: `dlv-led-${receipt.id}-${idx}`,
                        createdBy: req.user!.id,
                      },
                    });
                  }
                }
                if (hasDiscrepancy) {
                  await tx.discrepancyCase.create({
                    data: {
                      dispatchId: dispatch.id,
                      deliveryReceiptId: receipt.id,
                      expectedQuantity: totalExpected,
                      actualQuantity: totalAccepted,
                      damagedQuantity: totalDamaged,
                      missingQuantity: totalMissing,
                      difference: roundQty(totalExpected - totalAccepted),
                      status: DiscrepancyStatus.OPEN,
                    },
                  });
                }
                await tx.dispatch.update({
                  where: { id: dispatch.id },
                  data: {
                    status: hasDiscrepancy ? DispatchStatus.DISCREPANCY : DispatchStatus.DELIVERED,
                  },
                });
                return receipt;
              });
              await refreshCentreAlerts(dispatch.destinationCentreId);
            }
          }

          await prisma.syncOperation.upsert({
            where: { operationUuid: op.operationUuid },
            update: {
              status: SyncStatus.SYNCED,
              errorMessage: null,
              syncedAt: new Date(),
            },
            create: {
              operationUuid: op.operationUuid,
              operationType: op.operationType,
              userId: req.user!.id,
              centreId: centreIdForSync,
              status: SyncStatus.SYNCED,
              createdAt: new Date(op.createdAt),
              syncedAt: new Date(),
            },
          });

          await recordAuditLog(prisma, {
            actorId: req.user!.id,
            action: `SYNC_${op.operationType}`,
            entityType: 'SyncOperation',
            entityId: op.operationUuid,
          });

          results.push({
            operationUuid: op.operationUuid,
            status: 'SYNCED',
            data: resultData,
          });
        } catch (err) {
          const appErr = err instanceof AppError ? err : null;
          const isConflict = appErr ? [400, 404, 409].includes(appErr.statusCode) : false;
          const syncStatus = isConflict ? SyncStatus.CONFLICT : SyncStatus.FAILED;
          const message = err instanceof Error ? err.message : 'Synchronisation failed';

          await prisma.syncOperation.upsert({
            where: { operationUuid: op.operationUuid },
            update: {
              status: syncStatus,
              errorMessage: message,
              syncedAt: new Date(),
            },
            create: {
              operationUuid: op.operationUuid,
              operationType: op.operationType,
              userId: req.user!.id,
              centreId: req.user!.centreId,
              status: syncStatus,
              errorMessage: message,
              createdAt: new Date(op.createdAt),
              syncedAt: new Date(),
            },
          });

          results.push({
            operationUuid: op.operationUuid,
            status: syncStatus,
            message,
          });
        }
      }

      res.json({ success: true, data: { results } });
    } catch (err) {
      next(err);
    }
  }
);

syncRouter.get(
  '/pull',
  requireRoles(Role.AWW, Role.AWH, Role.SUPERVISOR),
  async (req, res, next) => {
    try {
      const centreId =
        typeof req.query.centreId === 'string' ? req.query.centreId : req.user!.centreId;
      if (!centreId) {
        throw new AppError(400, 'CENTRE_REQUIRED', 'centreId is required');
      }

      const centre = await assertCentreInScope(req.user!, centreId);
      const [products, inventorySummary, pendingDispatches, beneficiaries, recentDistributions, alerts] =
        await Promise.all([
          prisma.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
          getCentreInventorySummary(centre.id),
          prisma.dispatch.findMany({
            where: { destinationCentreId: centre.id, status: DispatchStatus.DISPATCHED },
            include: {
              supplier: { select: { id: true, name: true } },
              items: { include: { product: true, batch: true } },
            },
          }),
          prisma.beneficiaryReference.findMany({
            where: { centreId: centre.id, isActive: true },
            select: {
              id: true,
              centreId: true,
              localReference: true,
              displayName: true,
              displayNameGu: true,
              maskedIdLast4: true,
              yob: true,
              beneficiaryCategory: true,
              protectedCredentialReference: true,
              status: true,
              reviewRemarks: true,
            },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.distribution.findMany({
            where: { centreId: centre.id },
            include: {
              beneficiary: { select: { localReference: true, displayName: true, displayNameGu: true, maskedIdLast4: true } },
              product: { select: { name: true, nameGu: true, unit: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { distributedAt: 'desc' },
            take: 50,
          }),
          prisma.alert.findMany({
            where: { centreId: centre.id, isResolved: false },
            orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          }),
        ]);

      res.json({
        success: true,
        data: {
          syncedAt: new Date().toISOString(),
          centre,
          products,
          inventorySummary,
          pendingDispatches,
          beneficiaries,
          recentDistributions,
          alerts,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

syncRouter.get('/status', async (req, res, next) => {
  try {
    const operations = await prisma.syncOperation.findMany({
      where: { userId: req.user!.id },
      orderBy: { syncedAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: operations });
  } catch (err) {
    next(err);
  }
});

