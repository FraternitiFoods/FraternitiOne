-- DropIndex
DROP INDEX "ItemPhoto_itemId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ItemPhoto_itemId_sortOrder_key" ON "ItemPhoto"("itemId", "sortOrder");
