-- CreateEnum
CREATE TYPE "OpsBoqStatus" AS ENUM ('NOT_SHARED', 'SHARED');

-- CreateTable
CREATE TABLE "OpsBoqRow" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "sno" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "fixedKey" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "vendor" TEXT,
    "boqStatus" "OpsBoqStatus" NOT NULL DEFAULT 'NOT_SHARED',
    "amount" DECIMAL(14,2),
    "linkBoq" TEXT,
    "linkApprovedBoq" TEXT,
    "linkPo" TEXT,
    "approvedVia" TEXT,
    "link" TEXT,
    "advanceGiven" DECIMAL(14,2),
    "stage" TEXT,
    "followUpDate" DATE,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "OpsBoqRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsBoqRow_siteId_sortOrder_idx" ON "OpsBoqRow"("siteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OpsBoqRow_siteId_fixedKey_key" ON "OpsBoqRow"("siteId", "fixedKey");

-- AddForeignKey
ALTER TABLE "OpsBoqRow" ADD CONSTRAINT "OpsBoqRow_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsBoqRow" ADD CONSTRAINT "OpsBoqRow_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

