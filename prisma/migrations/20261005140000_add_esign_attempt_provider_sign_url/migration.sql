-- plan.md section 19 L4: server-only column for the co-signer's signUrl
-- under decision 4's shared-document model. Nullable; unused by the mock
-- provider.

-- AlterTable
ALTER TABLE "EsignAttempt" ADD COLUMN "providerSignUrl" TEXT;
