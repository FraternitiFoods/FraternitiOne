-- plan.md section 20C: seven additional OnboardingFileKind values (SRD 8.1).
-- Purely additive — existing rows/values are untouched, so this cannot
-- re-lock or re-open any onboarding already past KYC review.
ALTER TYPE "OnboardingFileKind" ADD VALUE 'ADDRESS_PROOF';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'PHOTOGRAPH';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'BANK_STATEMENT';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'CANCELLED_CHEQUE';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'GST_CERT';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'PARTNERSHIP_DEED';
ALTER TYPE "OnboardingFileKind" ADD VALUE 'OTHER_SUPPORTING';
