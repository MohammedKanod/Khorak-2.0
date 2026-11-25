-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "BeneficiaryReference" ADD COLUMN     "requestedBy" UUID,
ADD COLUMN     "reviewRemarks" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" UUID,
ADD COLUMN     "status" "BeneficiaryStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "yob" TEXT;

-- CreateIndex
CREATE INDEX "BeneficiaryReference_status_idx" ON "BeneficiaryReference"("status");

-- AddForeignKey
ALTER TABLE "BeneficiaryReference" ADD CONSTRAINT "BeneficiaryReference_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryReference" ADD CONSTRAINT "BeneficiaryReference_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
