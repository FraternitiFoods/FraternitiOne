-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- AlterTable
ALTER TABLE "SiteItem" ADD COLUMN     "lockedRate" DECIMAL(14,2);

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
