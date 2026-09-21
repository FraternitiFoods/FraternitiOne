-- AlterTable
ALTER TABLE "Task" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "Task_category_idx" ON "Task"("category");
