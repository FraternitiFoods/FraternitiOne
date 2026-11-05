-- CreateEnum
CREATE TYPE "DashboardStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED');

-- CreateTable
CREATE TABLE "DashboardSyncRun" (
    "id" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "trigger" TEXT,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "counts" JSONB,
    "warnings" JSONB,
    "mismatches" JSONB,
    "deptLinksPayload" JSONB,

    CONSTRAINT "DashboardSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSyncStagingChunk" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSyncStagingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSite" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "driveFolderUrl" TEXT,
    "sheetSummary" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardStep" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "stageNo" INTEGER NOT NULL,
    "stageName" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "parentKey" TEXT,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isParent" BOOLEAN NOT NULL DEFAULT false,
    "assignedTo" TEXT,
    "status" "DashboardStepStatus",
    "remark" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardDeptLink" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "siteId" TEXT,
    "stageFolderName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardDeptLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSiteAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSyncStagingChunk_runId_siteName_key" ON "DashboardSyncStagingChunk"("runId", "siteName");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSite_name_key" ON "DashboardSite"("name");

-- CreateIndex
CREATE INDEX "DashboardStep_siteId_idx" ON "DashboardStep"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardStep_siteId_stageNo_stepKey_key" ON "DashboardStep"("siteId", "stageNo", "stepKey");

-- CreateIndex
CREATE INDEX "DashboardDeptLink_siteId_idx" ON "DashboardDeptLink"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSiteAssignment_userId_key" ON "DashboardSiteAssignment"("userId");

-- CreateIndex
CREATE INDEX "DashboardSiteAssignment_siteId_idx" ON "DashboardSiteAssignment"("siteId");

-- AddForeignKey
ALTER TABLE "DashboardSyncStagingChunk" ADD CONSTRAINT "DashboardSyncStagingChunk_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DashboardSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardStep" ADD CONSTRAINT "DashboardStep_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "DashboardSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardDeptLink" ADD CONSTRAINT "DashboardDeptLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "DashboardSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSiteAssignment" ADD CONSTRAINT "DashboardSiteAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSiteAssignment" ADD CONSTRAINT "DashboardSiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "DashboardSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSiteAssignment" ADD CONSTRAINT "DashboardSiteAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
