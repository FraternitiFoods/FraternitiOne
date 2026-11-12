-- CreateEnum
CREATE TYPE "DashboardSiteOrigin" AS ENUM ('SHEET', 'WEBSITE');

-- AlterTable
ALTER TABLE "DashboardSite" ADD COLUMN     "deptLinksText" TEXT,
ADD COLUMN     "origin" "DashboardSiteOrigin" NOT NULL DEFAULT 'SHEET';
