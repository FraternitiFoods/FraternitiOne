-- plan.md section 19 (rewritten 2026-10-03): LOI signing moved from mobile
-- OTP to Aadhaar eSign via Leegality. Reverses
-- 20261001062755_add_loi_otp_signing in full: drops LoiAcceptance (depends
-- on OtpChallenge), then OtpChallenge, their status/channel enums, and the
-- two LoiVersion preview-opened columns and NotificationLog.channel column
-- that existed only to support the OTP flow.

-- DropForeignKey
ALTER TABLE "LoiAcceptance" DROP CONSTRAINT "LoiAcceptance_otpChallengeId_fkey";
ALTER TABLE "LoiAcceptance" DROP CONSTRAINT "LoiAcceptance_signerUserId_fkey";
ALTER TABLE "LoiAcceptance" DROP CONSTRAINT "LoiAcceptance_loiVersionId_fkey";
ALTER TABLE "OtpChallenge" DROP CONSTRAINT "OtpChallenge_signerUserId_fkey";
ALTER TABLE "OtpChallenge" DROP CONSTRAINT "OtpChallenge_loiVersionId_fkey";
ALTER TABLE "OtpChallenge" DROP CONSTRAINT "OtpChallenge_onboardingId_fkey";

-- DropTable
DROP TABLE "LoiAcceptance";

-- DropTable
DROP TABLE "OtpChallenge";

-- DropEnum
DROP TYPE "OtpChallengeStatus";

-- AlterTable
ALTER TABLE "NotificationLog" DROP COLUMN "channel";

-- DropEnum
DROP TYPE "NotificationChannel";

-- AlterTable
ALTER TABLE "LoiVersion" DROP COLUMN "companyPreviewOpenedAt",
DROP COLUMN "franchiseePreviewOpenedAt";
