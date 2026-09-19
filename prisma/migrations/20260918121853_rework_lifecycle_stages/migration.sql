-- Lifecycle stages are no longer a single project-wide "current stage": each
-- stage's status is now derived from its own tasks (see Task.lifecycleStage
-- below) with an admin-only force-complete override (ProjectStageOverride).
-- Confirmed with product owner (2026-09-18): only dev/test data exists, safe
-- to drop the old column outright rather than migrate its values.

-- DropColumn (FranchiseProject no longer carries a single current stage)
ALTER TABLE "FranchiseProject" DROP COLUMN "lifecycleStage";

-- Replace LifecycleStage enum values entirely — regrouped to match the
-- franchise lifecycle tracker sheet. No column references the type once the
-- column above is dropped, so it's safe to drop and recreate under the same
-- name.
DROP TYPE "LifecycleStage";
CREATE TYPE "LifecycleStage" AS ENUM ('SALES_FRANCHISE_ACQUISITION', 'LOCATION_ACQUISITION', 'LEGAL_COMPLIANCE', 'PROJECT_HANDOVER', 'DESIGN', 'BOQ_PROCUREMENT', 'CONSTRUCTION_EXECUTION', 'LICENSING', 'OPERATIONS_PREPARATION', 'TECHNOLOGY_DEPLOYMENT', 'PRE_LAUNCH_MARKETING', 'GRAND_LAUNCH', 'POST_OPENING');

-- AddColumn (Task.lifecycleStage) — nullable first so existing rows don't
-- fail the NOT NULL constraint, backfilled below, then locked down.
ALTER TABLE "Task" ADD COLUMN "lifecycleStage" "LifecycleStage";
UPDATE "Task" SET "lifecycleStage" = 'SALES_FRANCHISE_ACQUISITION' WHERE "lifecycleStage" IS NULL;
ALTER TABLE "Task" ALTER COLUMN "lifecycleStage" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Task_lifecycleStage_idx" ON "Task"("lifecycleStage");

-- CreateTable
CREATE TABLE "ProjectStageOverride" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "LifecycleStage" NOT NULL,
    "completedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStageOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectStageOverride_projectId_idx" ON "ProjectStageOverride"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStageOverride_projectId_stage_key" ON "ProjectStageOverride"("projectId", "stage");

-- AddForeignKey
ALTER TABLE "ProjectStageOverride" ADD CONSTRAINT "ProjectStageOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FranchiseProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStageOverride" ADD CONSTRAINT "ProjectStageOverride_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
