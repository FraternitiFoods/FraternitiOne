-- CreateEnum
CREATE TYPE "SalesSource" AS ENUM ('CSV', 'MANUAL', 'API');

-- CreateTable
CREATE TABLE "SalesDay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "grossSales" INTEGER NOT NULL,
    "netSales" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "source" "SalesSource" NOT NULL DEFAULT 'CSV',
    "importBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImportBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rowsRead" INTEGER NOT NULL,
    "rowsInserted" INTEGER NOT NULL,
    "rowsUpdated" INTEGER NOT NULL,
    "rowsRejected" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesDay_projectId_idx" ON "SalesDay"("projectId");

-- CreateIndex
CREATE INDEX "SalesDay_importBatchId_idx" ON "SalesDay"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDay_projectId_date_key" ON "SalesDay"("projectId", "date");

-- CreateIndex
CREATE INDEX "SalesImportBatch_projectId_idx" ON "SalesImportBatch"("projectId");

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FranchiseProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "SalesImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImportBatch" ADD CONSTRAINT "SalesImportBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FranchiseProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImportBatch" ADD CONSTRAINT "SalesImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
