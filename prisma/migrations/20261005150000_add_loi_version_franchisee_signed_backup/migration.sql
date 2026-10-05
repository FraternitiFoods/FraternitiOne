-- plan.md section 19 L5, edge case 2: backup of what Leegality holds right
-- after the franchisee signs (the shared document can later be voided).
-- Nullable; unused by the mock provider.

-- AlterTable
ALTER TABLE "LoiVersion" ADD COLUMN "franchiseeSignedPdfB2Key" TEXT;
ALTER TABLE "LoiVersion" ADD COLUMN "franchiseeSignedPdfSha256" TEXT;
