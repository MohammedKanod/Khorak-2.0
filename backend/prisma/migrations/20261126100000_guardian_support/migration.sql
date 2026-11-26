-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GUARDIAN';

-- CreateTable
CREATE TABLE "GuardianRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "guardianId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "category" "BeneficiaryCategory" NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewRemarks" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "GuardianRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianRequest_reference_key" ON "GuardianRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianRequest_idempotencyKey_key" ON "GuardianRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GuardianRequest_guardianId_createdAt_idx" ON "GuardianRequest"("guardianId", "createdAt");

-- CreateIndex
CREATE INDEX "GuardianRequest_centreId_status_idx" ON "GuardianRequest"("centreId", "status");

-- AddForeignKey
ALTER TABLE "GuardianRequest" ADD CONSTRAINT "GuardianRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianRequest" ADD CONSTRAINT "GuardianRequest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

