-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AWAITING_SUPPLIER_RESPONSE', 'SUPPLIER_RESPONDED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "StockRequestReason" AS ENUM ('LOW_STOCK', 'EXPECTED_DEMAND', 'DAMAGED_STOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'AWAITING_DISPATCH', 'DISPATCHED', 'RECEIVED', 'COMPLETED');

-- DropIndex
DROP INDEX "Distribution_beneficiaryReferenceId_productId_distributionD_idx";

-- AlterTable
ALTER TABLE "AnganwadiCentre" ADD COLUMN     "offlineCredentialSalt" TEXT;

-- AlterTable
ALTER TABLE "BeneficiaryReference" ADD COLUMN     "idempotencyKey" TEXT,
ALTER COLUMN "maskedIdLast4" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "stockRequestId" UUID;

-- CreateTable
CREATE TABLE "DispatchAppeal" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchAppealHistory" (
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
);

-- CreateTable
CREATE TABLE "StockRequest" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestHistory" (
    "id" UUID NOT NULL,
    "stockRequestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromStatus" "StockRequestStatus",
    "toStatus" "StockRequestStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchAppeal_appealReference_key" ON "DispatchAppeal"("appealReference");

-- CreateIndex
CREATE INDEX "DispatchAppeal_supplierId_status_idx" ON "DispatchAppeal"("supplierId", "status");

-- CreateIndex
CREATE INDEX "DispatchAppeal_centreId_status_idx" ON "DispatchAppeal"("centreId", "status");

-- CreateIndex
CREATE INDEX "DispatchAppeal_discrepancyCaseId_idx" ON "DispatchAppeal"("discrepancyCaseId");

-- CreateIndex
CREATE INDEX "DispatchAppealHistory_appealId_createdAt_idx" ON "DispatchAppealHistory"("appealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_idempotencyKey_key" ON "StockRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockRequest_centreId_status_idx" ON "StockRequest"("centreId", "status");

-- CreateIndex
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");

-- CreateIndex
CREATE INDEX "StockRequestHistory_stockRequestId_createdAt_idx" ON "StockRequestHistory"("stockRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BeneficiaryReference_idempotencyKey_key" ON "BeneficiaryReference"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Dispatch_stockRequestId_idx" ON "Dispatch"("stockRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Distribution_centreId_beneficiaryReferenceId_productId_dist_key" ON "Distribution"("centreId", "beneficiaryReferenceId", "productId", "distributionDay");

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_discrepancyCaseId_fkey" FOREIGN KEY ("discrepancyCaseId") REFERENCES "DiscrepancyCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_respondedBy_fkey" FOREIGN KEY ("respondedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppeal" ADD CONSTRAINT "DispatchAppeal_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppealHistory" ADD CONSTRAINT "DispatchAppealHistory_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "DispatchAppeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchAppealHistory" ADD CONSTRAINT "DispatchAppealHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestHistory" ADD CONSTRAINT "StockRequestHistory_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestHistory" ADD CONSTRAINT "StockRequestHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

