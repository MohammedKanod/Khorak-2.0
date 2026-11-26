-- AlterTable
ALTER TABLE "StockRequest" ADD COLUMN     "assignedSupplierId" UUID;

-- CreateTable
CREATE TABLE "BlockSupplier" (
    "id" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "contactInformation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BlockSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalNote" (
    "id" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" "Role" NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockSupplier_blockId_supplierId_key" ON "BlockSupplier"("blockId", "supplierId");

-- CreateIndex
CREATE INDEX "OperationalNote_centreId_createdAt_idx" ON "OperationalNote"("centreId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_assignedSupplierId_fkey" FOREIGN KEY ("assignedSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockSupplier" ADD CONSTRAINT "BlockSupplier_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockSupplier" ADD CONSTRAINT "BlockSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalNote" ADD CONSTRAINT "OperationalNote_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "AnganwadiCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve existing supplier/block relationships from delivery history.
INSERT INTO "BlockSupplier" ("id", "blockId", "supplierId", "contactInformation", "isActive")
SELECT gen_random_uuid(), s."blockId", d."supplierId", MAX(p."contactInformation"), true
FROM "Dispatch" d JOIN "AnganwadiCentre" c ON c.id = d."destinationCentreId"
JOIN "Sector" s ON s.id = c."sectorId" JOIN "Supplier" p ON p.id = d."supplierId"
GROUP BY s."blockId", d."supplierId";
