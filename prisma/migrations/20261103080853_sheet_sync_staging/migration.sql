-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "sitesPayload" JSONB,
ADD COLUMN     "trigger" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "sheetLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BoqSyncStagingChunk" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoqSyncStagingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoqSyncStagingChunk_runId_category_key" ON "BoqSyncStagingChunk"("runId", "category");

-- AddForeignKey
ALTER TABLE "BoqSyncStagingChunk" ADD CONSTRAINT "BoqSyncStagingChunk_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
