-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "attachmentScanError" TEXT,
ADD COLUMN     "attachmentScanStatus" "ScanStatus";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "scanError" TEXT,
ADD COLUMN     "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING';
