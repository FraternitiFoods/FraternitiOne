-- CreateEnum
CREATE TYPE "TrackerStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "TrackerEvidenceKind" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "usedInBoq" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usedInTracker" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TrackerSection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackerSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerStep" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackerStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerSiteStep" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "TrackerStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assignee" TEXT,
    "remark" TEXT,
    "notRequiredReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "legacyCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackerSiteStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerEvidence" (
    "id" TEXT NOT NULL,
    "siteStepId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "TrackerEvidenceKind" NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackerEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackerSection_name_key" ON "TrackerSection"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerStep_code_key" ON "TrackerStep"("code");

-- CreateIndex
CREATE INDEX "TrackerStep_sectionId_idx" ON "TrackerStep"("sectionId");

-- CreateIndex
CREATE INDEX "TrackerSiteStep_stepId_idx" ON "TrackerSiteStep"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerSiteStep_siteId_stepId_key" ON "TrackerSiteStep"("siteId", "stepId");

-- CreateIndex
CREATE INDEX "TrackerEvidence_siteStepId_idx" ON "TrackerEvidence"("siteStepId");

-- AddForeignKey
ALTER TABLE "TrackerStep" ADD CONSTRAINT "TrackerStep_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TrackerSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerSiteStep" ADD CONSTRAINT "TrackerSiteStep_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerSiteStep" ADD CONSTRAINT "TrackerSiteStep_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "TrackerStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerSiteStep" ADD CONSTRAINT "TrackerSiteStep_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerSiteStep" ADD CONSTRAINT "TrackerSiteStep_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerEvidence" ADD CONSTRAINT "TrackerEvidence_siteStepId_fkey" FOREIGN KEY ("siteStepId") REFERENCES "TrackerSiteStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerEvidence" ADD CONSTRAINT "TrackerEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
