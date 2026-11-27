import { prisma } from './prisma';
import { computeHmacCredentialRef, generateCentreSalt } from './credential';
import { ensureDefaultEntitlementRules } from '../services/entitlement.service';

let schemaReadyPromise: Promise<void> | null = null;

async function isSchemaUpToDate(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ ready: boolean }>>(`
    SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'AnganwadiCentre' AND column_name = 'offlineCredentialSalt'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Distribution' AND column_name = 'distributionMonth'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Dispatch' AND column_name = 'vehicleNumber'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'DispatchAppeal'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'StockRequest'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'EntitlementRule'
      )
    ) AS "ready"
  `);
  return Boolean(rows[0]?.ready);
}

async function applyIdempotentUpgrade(): Promise<void> {
  const ddlStatements = [
    `DO $$ BEGIN CREATE TYPE "AppealStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AWAITING_SUPPLIER_RESPONSE', 'SUPPLIER_RESPONDED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TYPE "BeneficiaryCategory" ADD VALUE IF NOT EXISTS 'SEVERELY_UNDERWEIGHT_CHILD_6M_3Y'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE TYPE "StockRequestReason" AS ENUM ('LOW_STOCK', 'EXPECTED_DEMAND', 'DAMAGED_STOCK', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE TYPE "StockRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'AWAITING_DISPATCH', 'DISPATCHED', 'RECEIVED', 'COMPLETED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DROP INDEX IF EXISTS "Distribution_beneficiaryReferenceId_productId_distributionD_idx"`,
    `ALTER TABLE "AnganwadiCentre" ADD COLUMN IF NOT EXISTS "offlineCredentialSalt" TEXT`,
    `ALTER TABLE "BeneficiaryReference" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT`,
    `DO $$ BEGIN ALTER TABLE "BeneficiaryReference" ALTER COLUMN "maskedIdLast4" DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
    `ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "stockRequestId" UUID`,
    `ALTER TABLE "Dispatch" ADD COLUMN IF NOT EXISTS "vehicleNumber" TEXT`,
    `ALTER TABLE "Distribution" ADD COLUMN IF NOT EXISTS "distributionMonth" TEXT`,
    `ALTER TABLE "Distribution" ADD COLUMN IF NOT EXISTS "isExceptionOverride" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Distribution" ADD COLUMN IF NOT EXISTS "exceptionReason" TEXT`,
    `UPDATE "Distribution" SET "distributionMonth" = LEFT("distributionDay", 7) WHERE "distributionMonth" IS NULL`,
    `DO $$ BEGIN ALTER TABLE "Distribution" ALTER COLUMN "distributionMonth" SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
    `CREATE TABLE IF NOT EXISTS "EntitlementRule" (
      "id" UUID NOT NULL,
      "beneficiaryCategory" "BeneficiaryCategory" NOT NULL,
      "productId" UUID,
      "monthlyLimit" DOUBLE PRECISION,
      "packetWeightGrams" INTEGER,
      "packetWeightLabel" TEXT,
      "isConfigured" BOOLEAN NOT NULL DEFAULT true,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "notes" TEXT,
      "updatedBy" UUID,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EntitlementRule_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "DispatchAppeal" (
      "id" UUID NOT NULL,
      "appealReference" TEXT NOT NULL,
      "discrepancyCaseId" UUID NOT NULL,
      "dispatchId" UUID NOT NULL,
      "supplierId" UUID NOT NULL,
      "centreId" UUID NOT NULL,
      "productId" UUID,
      "batchId" UUID,
      "dispatchedQuantity" DOUBLE PRECISION NOT NULL,
      "receivedQuantity" DOUBLE PRECISION NOT NULL,
      "damagedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "missingQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "evidenceUrl" TEXT,
      "supervisorRemarks" TEXT NOT NULL,
      "supplierRemarks" TEXT,
      "supplierEvidenceUrl" TEXT,
      "resolutionRemarks" TEXT,
      "status" "AppealStatus" NOT NULL DEFAULT 'AWAITING_SUPPLIER_RESPONSE',
      "createdBy" UUID NOT NULL,
      "respondedBy" UUID,
      "resolvedBy" UUID,
      "respondedAt" TIMESTAMP(3),
      "resolvedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DispatchAppeal_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "DispatchAppealHistory" (
      "id" UUID NOT NULL,
      "appealId" UUID NOT NULL,
      "actorId" UUID NOT NULL,
      "fromStatus" "AppealStatus",
      "toStatus" "AppealStatus" NOT NULL,
      "action" TEXT NOT NULL,
      "remarks" TEXT NOT NULL,
      "evidenceUrl" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DispatchAppealHistory_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "StockRequest" (
      "id" UUID NOT NULL,
      "requestNumber" TEXT NOT NULL,
      "centreId" UUID NOT NULL,
      "productId" UUID NOT NULL,
      "requestedQuantity" DOUBLE PRECISION NOT NULL,
      "approvedQuantity" DOUBLE PRECISION,
      "reason" "StockRequestReason" NOT NULL,
      "remarks" TEXT,
      "status" "StockRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
      "requestedBy" UUID NOT NULL,
      "reviewedBy" UUID,
      "reviewRemarks" TEXT,
      "reviewedAt" TIMESTAMP(3),
      "idempotencyKey" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "StockRequestHistory" (
      "id" UUID NOT NULL,
      "stockRequestId" UUID NOT NULL,
      "actorId" UUID NOT NULL,
      "fromStatus" "StockRequestStatus",
      "toStatus" "StockRequestStatus" NOT NULL,
      "action" TEXT NOT NULL,
      "remarks" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StockRequestHistory_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DispatchAppeal_appealReference_key" ON "DispatchAppeal"("appealReference")`,
    `CREATE INDEX IF NOT EXISTS "DispatchAppeal_supplierId_status_idx" ON "DispatchAppeal"("supplierId", "status")`,
    `CREATE INDEX IF NOT EXISTS "DispatchAppeal_centreId_status_idx" ON "DispatchAppeal"("centreId", "status")`,
    `CREATE INDEX IF NOT EXISTS "DispatchAppeal_discrepancyCaseId_idx" ON "DispatchAppeal"("discrepancyCaseId")`,
    `CREATE INDEX IF NOT EXISTS "DispatchAppealHistory_appealId_createdAt_idx" ON "DispatchAppealHistory"("appealId", "createdAt")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "StockRequest_idempotencyKey_key" ON "StockRequest"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "StockRequest_centreId_status_idx" ON "StockRequest"("centreId", "status")`,
    `CREATE INDEX IF NOT EXISTS "StockRequest_status_idx" ON "StockRequest"("status")`,
    `CREATE INDEX IF NOT EXISTS "StockRequestHistory_stockRequestId_createdAt_idx" ON "StockRequestHistory"("stockRequestId", "createdAt")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "BeneficiaryReference_idempotencyKey_key" ON "BeneficiaryReference"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "Dispatch_stockRequestId_idx" ON "Dispatch"("stockRequestId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "EntitlementRule_beneficiaryCategory_key" ON "EntitlementRule"("beneficiaryCategory")`,
    `CREATE INDEX IF NOT EXISTS "EntitlementRule_isActive_idx" ON "EntitlementRule"("isActive")`,
    `CREATE INDEX IF NOT EXISTS "Distribution_centreId_beneficiaryReferenceId_productId_dist_idx" ON "Distribution"("centreId", "beneficiaryReferenceId", "productId", "distributionMonth")`,
    `DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS "Distribution_centreId_beneficiaryReferenceId_productId_dist_key" ON "Distribution"("centreId", "beneficiaryReferenceId", "productId", "distributionDay"); EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_discrepancyCaseId_fkey" FOREIGN KEY ("discrepancyCaseId") REFERENCES "DiscrepancyCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_respondedBy_fkey" FOREIGN KEY ("respondedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppealHistory" ADD CONSTRAINT "DispatchAppealHistory_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "DispatchAppeal"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "DispatchAppealHistory" ADD CONSTRAINT "DispatchAppealHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequestHistory" ADD CONSTRAINT "StockRequestHistory_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "StockRequestHistory" ADD CONSTRAINT "StockRequestHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "EntitlementRule" ADD CONSTRAINT "EntitlementRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN ALTER TABLE "EntitlementRule" ADD CONSTRAINT "EntitlementRule_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  ];

  for (const stmt of ddlStatements) {
    await prisma.$executeRawUnsafe(stmt);
  }

  await ensureDefaultEntitlementRules(prisma);

  // Ensure every active centre has an offline HMAC salt and upgrade any legacy maskedIdLast4 beneficiary rows
  const centres = await prisma.anganwadiCentre.findMany({
    select: { id: true, offlineCredentialSalt: true },
  });
  const saltMap = new Map<string, string>();
  for (const c of centres) {
    const salt = c.offlineCredentialSalt || generateCentreSalt();
    saltMap.set(c.id, salt);
    if (!c.offlineCredentialSalt) {
      await prisma.anganwadiCentre.update({
        where: { id: c.id },
        data: { offlineCredentialSalt: salt },
      });
    }
  }

  const legacyRows = await prisma.beneficiaryReference.findMany({
    where: { maskedIdLast4: { not: null } },
    select: {
      id: true,
      centreId: true,
      displayName: true,
      yob: true,
      maskedIdLast4: true,
    },
  });
  for (const b of legacyRows) {
    const salt = saltMap.get(b.centreId);
    if (salt && b.maskedIdLast4 && b.yob) {
      await prisma.beneficiaryReference.update({
        where: { id: b.id },
        data: {
          protectedCredentialReference: computeHmacCredentialRef({
            salt,
            last4: b.maskedIdLast4,
            name: b.displayName,
            yob: b.yob,
          }),
          maskedIdLast4: null,
        },
      });
    } else {
      await prisma.beneficiaryReference.update({
        where: { id: b.id },
        data: { maskedIdLast4: null },
      });
    }
  }
}

export async function ensureProductionSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const ready = await isSchemaUpToDate();
      if (!ready) {
        await applyIdempotentUpgrade();
      }
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  return schemaReadyPromise;
}

