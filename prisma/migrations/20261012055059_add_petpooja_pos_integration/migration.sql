-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('SUCCESS', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PosWebhookOutcome" AS ENUM ('IGNORED_UNKNOWN_OUTLET', 'FAILED', 'REJECTED_AUTH');

-- DropForeignKey
ALTER TABLE "SalesDay" DROP CONSTRAINT "SalesDay_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SalesDay" DROP CONSTRAINT "SalesDay_updatedById_fkey";

-- AlterTable
ALTER TABLE "FranchiseProject" ADD COLUMN     "petpoojaRestId" TEXT,
ADD COLUMN     "posLiveFrom" DATE;

-- AlterTable
ALTER TABLE "SalesDay" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "createdById" DROP NOT NULL,
ALTER COLUMN "updatedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "restId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "createdAtIst" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "orderType" TEXT NOT NULL,
    "subOrderType" TEXT,
    "orderFrom" TEXT NOT NULL,
    "aggregatorOrderId" TEXT,
    "paymentType" TEXT NOT NULL,
    "partPayments" JSONB,
    "status" "PosOrderStatus" NOT NULL,
    "coreTotal" INTEGER NOT NULL,
    "discountTotal" INTEGER NOT NULL,
    "taxTotal" INTEGER NOT NULL,
    "packagingCharge" INTEGER NOT NULL,
    "deliveryCharge" INTEGER NOT NULL,
    "serviceCharge" INTEGER NOT NULL,
    "roundOff" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "flags" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosWebhookEvent" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restId" TEXT,
    "outcome" "PosWebhookOutcome" NOT NULL,
    "error" TEXT,
    "payload" JSONB,
    "reprocessedAt" TIMESTAMP(3),
    "reprocessedById" TEXT,

    CONSTRAINT "PosWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosOrder_projectId_businessDate_status_idx" ON "PosOrder"("projectId", "businessDate", "status");

-- CreateIndex
CREATE INDEX "PosOrder_restId_receivedAt_idx" ON "PosOrder"("restId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_restId_orderId_key" ON "PosOrder"("restId", "orderId");

-- CreateIndex
CREATE INDEX "PosWebhookEvent_restId_receivedAt_idx" ON "PosWebhookEvent"("restId", "receivedAt");

-- CreateIndex
CREATE INDEX "PosWebhookEvent_outcome_receivedAt_idx" ON "PosWebhookEvent"("outcome", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseProject_petpoojaRestId_key" ON "FranchiseProject"("petpoojaRestId");

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDay" ADD CONSTRAINT "SalesDay_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FranchiseProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosWebhookEvent" ADD CONSTRAINT "PosWebhookEvent_reprocessedById_fkey" FOREIGN KEY ("reprocessedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

