-- AlterEnum
ALTER TYPE "BeneficiaryCategory" ADD VALUE IF NOT EXISTS 'SEVERELY_UNDERWEIGHT_CHILD_6M_3Y';

-- AlterTable Distribution (preserve existing rows by backfilling distributionMonth from distributionDay YYYY-MM)
ALTER TABLE "Distribution"
  ADD COLUMN IF NOT EXISTS "distributionMonth" TEXT,
  ADD COLUMN IF NOT EXISTS "isExceptionOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exceptionReason" TEXT;

UPDATE "Distribution"
SET "distributionMonth" = LEFT("distributionDay", 7)
WHERE "distributionMonth" IS NULL;

ALTER TABLE "Distribution"
  ALTER COLUMN "distributionMonth" SET NOT NULL;

-- CreateTable EntitlementRule
CREATE TABLE IF NOT EXISTS "EntitlementRule" (
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
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EntitlementRule_beneficiaryCategory_key" ON "EntitlementRule"("beneficiaryCategory");
CREATE INDEX IF NOT EXISTS "EntitlementRule_isActive_idx" ON "EntitlementRule"("isActive");
CREATE INDEX IF NOT EXISTS "Distribution_centreId_beneficiaryReferenceId_productId_dist_idx" ON "Distribution"("centreId", "beneficiaryReferenceId", "productId", "distributionMonth");

-- AddForeignKey
ALTER TABLE "EntitlementRule" ADD CONSTRAINT "EntitlementRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntitlementRule" ADD CONSTRAINT "EntitlementRule_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

