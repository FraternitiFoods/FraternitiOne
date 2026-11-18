-- CreateEnum
CREATE TYPE "SyncLegKind" AS ENUM ('STAGES', 'SITE_BOQ', 'OPS_BOQ');

-- CreateEnum
CREATE TYPE "SyncLegStatus" AS ENUM ('RUNNING', 'COMMITTED', 'FAILED');

-- AlterTable
ALTER TABLE "DashboardSyncRun" ADD COLUMN     "manifestPayload" JSONB;

-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "tabManifest" JSONB;

-- AlterTable
ALTER TABLE "OpsBoqRow" ADD COLUMN     "fromSheet" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SiteAlias" (
    "aliasNorm" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAlias_pkey" PRIMARY KEY ("aliasNorm")
);

-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "triggeredById" TEXT,
    "force" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLeg" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "leg" "SyncLegKind" NOT NULL,
    "status" "SyncLegStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "runId" TEXT,
    "counts" JSONB,
    "warnings" JSONB,
    "createdSites" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "SyncLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncContentHash" (
    "leg" "SyncLegKind" NOT NULL,
    "unitKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncContentHash_pkey" PRIMARY KEY ("leg","unitKey")
);

-- CreateIndex
CREATE INDEX "SiteAlias_siteId_idx" ON "SiteAlias"("siteId");

-- CreateIndex
CREATE INDEX "SyncBatch_startedAt_idx" ON "SyncBatch"("startedAt");

-- CreateIndex
CREATE INDEX "SyncLeg_leg_startedAt_idx" ON "SyncLeg"("leg", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncLeg_batchId_leg_key" ON "SyncLeg"("batchId", "leg");

-- AddForeignKey
ALTER TABLE "SiteAlias" ADD CONSTRAINT "SiteAlias_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLeg" ADD CONSTRAINT "SyncLeg_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SyncBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

