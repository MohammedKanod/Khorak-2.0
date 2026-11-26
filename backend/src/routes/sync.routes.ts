import { Router } from 'express';
import { z } from 'zod';
import {
  BeneficiaryCategory,
  DiscrepancyStatus,
  DispatchStatus,
  LedgerEventType,
  Role,
  SpoilageStatus,
  StockRequestReason,
  StockRequestStatus,
  SyncStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { assertCentreInScope, requireAuth, requireRoles } from '../middleware/auth';
import {
  executeCreateBeneficiary,
  executeDistribution,
  executeMultiDistribution,
} from './distribution.routes';
import { executeCreateStockRequest } from './stockRequests.routes';
import {
  acquireStockLock,
  allocateFefoBatches,
  getCentreBatchBalances,
  getCentreInventorySummary,
} from '../services/ledger.service';
import { refreshCentreAlerts } from '../services/alert.service';
import { recordAuditLog } from '../lib/audit';
import { formatIstMonth, roundQty } from '../lib/math';
import { generateCentreSalt } from '../lib/credential';
import { ensureDefaultEntitlementRules } from '../services/entitlement.service';

export const syncRouter = Router();

syncRouter.use(requireAuth);

const syncItemSchema = z.object({
  operationUuid: z.string().min(8).max(120),
  operationType: z.enum([
    'CREATE_BENEFICIARY',
    'DISTRIBUTION',
    'CONSUMPTION',
    'SPOILAGE',
    'RECEIVE_DISPATCH',
    'CREATE_STOCK_REQUEST',
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

          if (op.operationType === 'CREATE_BENEFICIARY') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                localReference: z.string().min(3).max(40).optional(),
                displayName: z.string().min(2).max(120),
                displayNameGu: z.string().max(120).optional(),
                yob: z.string().regex(/^\d{4}$/),
                beneficiaryCategory: z.nativeEnum(BeneficiaryCategory),
                protectedCredentialReference: z.string().min(16).max(128).optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            const exec = await executeCreateBeneficiary({
              userId: req.user!.id,
              userRole: req.user!.role,
              centreId: targetCentreId,
              localReference: p.localReference,
              displayName: p.displayName,
              displayNameGu: p.displayNameGu,
              yob: p.yob,
              beneficiaryCategory: p.beneficiaryCategory,
              protectedCredentialReference: p.protectedCredentialReference,
              idempotencyKey: op.operationUuid,
            });
            resultData = exec.beneficiary;
          } else if (op.operationType === 'CREATE_STOCK_REQUEST') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                productId: z.string().uuid(),
                requestedQuantity: z.coerce.number().positive().max(5000),
                reason: z.nativeEnum(StockRequestReason),
                remarks: z.string().max(400).optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            const exec = await executeCreateStockRequest({
              userId: req.user!.id,
              centreId: targetCentreId,
              productId: p.productId,
              requestedQuantity: p.requestedQuantity,
              reason: p.reason,
              remarks: p.remarks,
              idempotencyKey: op.operationUuid,
            });
            resultData = exec.request;
          } else if (op.operationType === 'DISTRIBUTION') {
            const p = z
              .object({
                centreId: z.string().uuid().optional(),
                beneficiaryReferenceId: z.string().uuid(),
                productId: z.string().uuid().optional(),
                batchId: z.string().uuid().optional(),
                quantity: z.coerce.number().positive().optional(),
                items: z
                  .array(
                    z.object({
                      productId: z.string().uuid(),
                      batchId: z.string().uuid().optional(),
                      quantity: z.coerce.number().positive(),
                    })
                  )
                  .min(1)
                  .max(20)
                  .optional(),
                distributedAt: z.string().optional(),
                remarks: z.string().optional(),
              })
              .parse(op.payload);

            const targetCentreId = p.centreId || req.user!.centreId;
            if (!targetCentreId) throw new AppError(400, 'CENTRE_REQUIRED', 'Missing centreId');
            centreIdForSync = targetCentreId;
            await assertCentreInScope(req.user!, targetCentreId);

            if (p.items && p.items.length > 0) {
              const exec = await executeMultiDistribution({
                userId: req.user!.id,
                userRole: req.user!.role,
                centreId: targetCentreId,
                beneficiaryReferenceId: p.beneficiaryReferenceId,
                items: p.items,
                distributedAt: p.distributedAt ? new Date(p.distributedAt) : new Date(op.createdAt),
                idempotencyKey: op.operationUuid,
                remarks: p.remarks,
              });
              resultData = exec.distributions;
            } else {
              if (!p.quantity) {
                throw new AppError(400, 'INVALID_PAYLOAD', 'Distribution requires quantity or items');
              }
              const exec = await executeDistribution({
                userId: req.user!.id,
                userRole: req.user!.role,
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
            }
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
                await acquireStockLock(tx, targetCentreId, p.productId);
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

              const receivedKeys = new Set<string>();
              for (const item of p.items) {
                const k = `${item.productId}:${item.batchId}`;
                if (receivedKeys.has(k)) {
                  throw new AppError(400, 'DUPLICATE_RECEIPT_LINE', 'Duplicate product/batch line in receipt');
                }
                receivedKeys.add(k);
                const existsInDispatch = dispatch.items.some(
                  (d) => d.productId === item.productId && d.batchId === item.batchId
                );
                if (!existsInDispatch) {
                  throw new AppError(400, 'UNKNOWN_RECEIPT_LINE', 'Receipt contains line not belonging to dispatch');
                }
              }

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
                const lockKeys = Array.from(
                  new Set(itemsData.map((it) => `${dispatch.destinationCentreId}::${it.productId}`))
                ).sort();
                for (const key of lockKeys) {
                  const [, pid] = key.split('::');
                  await acquireStockLock(tx, dispatch.destinationCentreId, pid);
                }

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
                if (dispatch.stockRequestId) {
                  await tx.stockRequest.update({
                    where: { id: dispatch.stockRequestId },
                    data: {
                      status: hasDiscrepancy
                        ? StockRequestStatus.RECEIVED
                        : StockRequestStatus.COMPLETED,
                      history: {
                        create: {
                          actorId: req.user!.id,
                          fromStatus: StockRequestStatus.DISPATCHED,
                          toStatus: hasDiscrepancy
                            ? StockRequestStatus.RECEIVED
                            : StockRequestStatus.COMPLETED,
                          action: hasDiscrepancy ? 'RECEIVED_WITH_DISCREPANCY' : 'COMPLETED',
                          remarks: `Offline sync receipt recorded (${dispatch.dispatchReference})`,
                        },
                      },
                    },
                  });
                }
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
          const isConflict = appErr ? [400, 403, 404, 409].includes(appErr.statusCode) : false;
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
      if (!centre.offlineCredentialSalt) {
        const generatedSalt = generateCentreSalt();
        await prisma.anganwadiCentre.update({
          where: { id: centre.id },
          data: { offlineCredentialSalt: generatedSalt },
        });
        centre.offlineCredentialSalt = generatedSalt;
      }
      const currentMonth = formatIstMonth();
      await ensureDefaultEntitlementRules(prisma);
      const [
        products,
        inventorySummary,
        pendingDispatches,
        beneficiaries,
        recentDistributions,
        monthlyDistributions,
        entitlementRules,
        alerts,
        stockRequests,
      ] =
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
              beneficiary: { select: { localReference: true, displayName: true, displayNameGu: true } },
              product: { select: { name: true, nameGu: true, unit: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { distributedAt: 'desc' },
            take: 50,
          }),
          prisma.distribution.findMany({
            where: { centreId: centre.id, distributionMonth: currentMonth },
            select: {
              id: true,
              beneficiaryReferenceId: true,
              productId: true,
              quantity: true,
              distributionDay: true,
              distributionMonth: true,
              distributedAt: true,
            },
            orderBy: { distributedAt: 'desc' },
          }),
          prisma.entitlementRule.findMany({
            include: {
              product: {
                select: { id: true, code: true, name: true, nameGu: true, unit: true, category: true },
              },
            },
            orderBy: { beneficiaryCategory: 'asc' },
          }),
          prisma.alert.findMany({
            where: { centreId: centre.id, isResolved: false },
            orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          }),
          prisma.stockRequest.findMany({
            where: { centreId: centre.id },
            include: {
              product: { select: { id: true, name: true, nameGu: true, unit: true, category: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 30,
          }),
        ]);

      res.json({
        success: true,
        data: {
          syncedAt: new Date().toISOString(),
          currentMonth,
          centre,
          products,
          inventorySummary,
          pendingDispatches,
          beneficiaries,
          recentDistributions,
          monthlyDistributions,
          entitlementRules,
          alerts,
          stockRequests,
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

