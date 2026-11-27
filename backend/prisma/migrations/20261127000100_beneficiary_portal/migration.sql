ALTER TYPE "Role" RENAME VALUE 'GUARDIAN' TO 'BENEFICIARY';
ALTER TABLE "User" ADD COLUMN "beneficiaryId" UUID;
CREATE UNIQUE INDEX "User_beneficiaryId_key" ON "User"("beneficiaryId");
ALTER TABLE "User" ADD CONSTRAINT "User_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "BeneficiaryReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;
