-- Remove the sheet <-> website sync/import machinery (Unified Sync, the older
-- sheet-sync / dashboard-sync, and the M2 push import). The website is the
-- source of truth. Irreversible: drops sync run history, content hashes, the
-- sheet-sourced Department Links rows and the sheet summary columns.

-- Request / lock singletons the sync modules kept in AppSetting.
DELETE FROM "AppSetting" WHERE "key" IN ('sheetSyncRequest', 'dashboardSyncRequest', 'unifiedSyncLock');

-- DropForeignKey
ALTER TABLE "SiteAlias" DROP CONSTRAINT "SiteAlias_siteId_fkey";

-- DropForeignKey
ALTER TABLE "SyncLeg" DROP CONSTRAINT "SyncLeg_batchId_fkey";

-- DropForeignKey
ALTER TABLE "BoqSyncStagingChunk" DROP CONSTRAINT "BoqSyncStagingChunk_runId_fkey";

-- DropForeignKey
ALTER TABLE "DashboardSyncStagingChunk" DROP CONSTRAINT "DashboardSyncStagingChunk_runId_fkey";

-- DropForeignKey
ALTER TABLE "DashboardDeptLink" DROP CONSTRAINT "DashboardDeptLink_siteId_fkey";

-- AlterTable
ALTER TABLE "Site" DROP COLUMN "lastSeenRunId",
DROP COLUMN "sheetLocked";

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "lastSeenRunId";

-- AlterTable
ALTER TABLE "DashboardSite" DROP COLUMN "lastSeenRunId",
DROP COLUMN "lastSyncedAt",
DROP COLUMN "sheetSummary";

-- AlterTable
ALTER TABLE "OpsBoqRow" DROP COLUMN "fromSheet";

-- DropTable
DROP TABLE "SiteAlias";

-- DropTable
DROP TABLE "SyncBatch";

-- DropTable
DROP TABLE "SyncLeg";

-- DropTable
DROP TABLE "SyncContentHash";

-- DropTable
DROP TABLE "ImportRun";

-- DropTable
DROP TABLE "BoqSyncStagingChunk";

-- DropTable
DROP TABLE "DashboardSyncRun";

-- DropTable
DROP TABLE "DashboardSyncStagingChunk";

-- DropTable
DROP TABLE "DashboardDeptLink";

-- DropEnum
DROP TYPE "ImportRunStatus";

-- DropEnum
DROP TYPE "SyncLegKind";

-- DropEnum
DROP TYPE "SyncLegStatus";
