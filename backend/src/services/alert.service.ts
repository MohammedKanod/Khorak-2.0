import { AlertSeverity, AlertType, DiscrepancyStatus, DispatchStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getCentreInventorySummary } from './ledger.service';

export async function refreshCentreAlerts(centreId: string): Promise<void> {
  const [summary, openDiscrepancies, pendingDispatches] = await Promise.all([
    getCentreInventorySummary(centreId),
    prisma.discrepancyCase.count({
      where: {
        dispatch: { destinationCentreId: centreId },
        status: { in: [DiscrepancyStatus.OPEN, DiscrepancyStatus.RECOUNT_REQUESTED] },
      },
    }),
    prisma.dispatch.count({
      where: {
        destinationCentreId: centreId,
        status: DispatchStatus.DISPATCHED,
      },
    }),
  ]);

  // Resolve active alerts for this centre before re-evaluating current state
  await prisma.alert.updateMany({
    where: { centreId, isResolved: false },
    data: { isResolved: true, resolvedAt: new Date() },
  });

  const alertsToCreate: Array<{
    centreId: string;
    productId?: string;
    batchId?: string;
    alertType: AlertType;
    severity: AlertSeverity;
    message: string;
    messageGu: string;
    daysOfStock?: number;
    isEstimated: boolean;
  }> = [];

  for (const item of summary) {
    if (item.reorderLevel === 'STOCKOUT') {
      alertsToCreate.push({
        centreId,
        productId: item.productId,
        alertType: AlertType.STOCKOUT,
        severity: AlertSeverity.CRITICAL,
        message: `${item.productName}: Stockout (0 ${item.unit} usable)`,
        messageGu: `${item.productNameGu}: સ્ટોક ખલાસ (0 ${item.unit})`,
        daysOfStock: 0,
        isEstimated: item.isConsumptionEstimated,
      });
    } else if (item.reorderLevel === 'CRITICAL') {
      alertsToCreate.push({
        centreId,
        productId: item.productId,
        alertType: AlertType.REORDER_CRITICAL,
        severity: AlertSeverity.CRITICAL,
        message: `${item.productName}: Critical stock (${item.daysOfStock} days left${item.isConsumptionEstimated ? ', estimated' : ''})`,
        messageGu: `${item.productNameGu}: અત્યંત ઓછો સ્ટોક (${item.daysOfStock} દિવસ બાકી)`,
        daysOfStock: item.daysOfStock ?? undefined,
        isEstimated: item.isConsumptionEstimated,
      });
    } else if (item.reorderLevel === 'WARNING') {
      alertsToCreate.push({
        centreId,
        productId: item.productId,
        alertType: AlertType.REORDER_WARNING,
        severity: AlertSeverity.WARNING,
        message: `${item.productName}: Reorder warning (${item.daysOfStock} days left${item.isConsumptionEstimated ? ', estimated' : ''})`,
        messageGu: `${item.productNameGu}: રીઓર્ડર ચેતવણી (${item.daysOfStock} દિવસ બાકી)`,
        daysOfStock: item.daysOfStock ?? undefined,
        isEstimated: item.isConsumptionEstimated,
      });
    }

    for (const batch of item.batches) {
      if (batch.isExpired && batch.balance > 0) {
        alertsToCreate.push({
          centreId,
          productId: item.productId,
          batchId: batch.batchId,
          alertType: AlertType.EXPIRED,
          severity: AlertSeverity.CRITICAL,
          message: `Expired batch ${batch.batchNumber} (${item.productName}): ${batch.balance} ${item.unit} blocked from distribution`,
          messageGu: `એક્સપાયર્ડ બેચ ${batch.batchNumber} (${item.productNameGu}): ${batch.balance} ${item.unit} વિતરણ માટે બંધ`,
          isEstimated: false,
        });
      } else if (batch.isExpiringSoon && batch.balance > 0) {
        alertsToCreate.push({
          centreId,
          productId: item.productId,
          batchId: batch.batchId,
          alertType: AlertType.EXPIRING_SOON,
          severity: AlertSeverity.WARNING,
          message: `Batch ${batch.batchNumber} (${item.productName}) expires in ${batch.daysToExpiry} days`,
          messageGu: `બેચ ${batch.batchNumber} (${item.productNameGu}) ${batch.daysToExpiry} દિવસમાં એક્સપાયર થશે`,
          isEstimated: false,
        });
      }
    }
  }

  if (openDiscrepancies > 0) {
    alertsToCreate.push({
      centreId,
      alertType: AlertType.DISCREPANCY,
      severity: AlertSeverity.WARNING,
      message: `${openDiscrepancies} unresolved delivery discrepancy case(s)`,
      messageGu: `${openDiscrepancies} ડિલિવરી તફાવત કેસ તપાસ હેઠળ`,
      isEstimated: false,
    });
  }

  if (pendingDispatches > 0) {
    alertsToCreate.push({
      centreId,
      alertType: AlertType.PENDING_DELIVERY,
      severity: AlertSeverity.INFO,
      message: `${pendingDispatches} incoming delivery dispatch(es) awaiting receipt`,
      messageGu: `${pendingDispatches} આવનારી ડિલિવરી સ્વીકારવાની બાકી`,
      isEstimated: false,
    });
  }

  if (alertsToCreate.length > 0) {
    await prisma.alert.createMany({ data: alertsToCreate });
  }
}

export async function refreshAllActiveCentreAlerts(): Promise<void> {
  const centres = await prisma.anganwadiCentre.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  for (const c of centres) {
    await refreshCentreAlerts(c.id);
  }
}

