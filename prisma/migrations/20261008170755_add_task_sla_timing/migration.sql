-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "slaDays" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");
