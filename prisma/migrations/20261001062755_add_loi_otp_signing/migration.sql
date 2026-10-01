-- CreateEnum
CREATE TYPE "OtpChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "LoiVersion" ADD COLUMN     "companyPreviewOpenedAt" TIMESTAMP(3),
ADD COLUMN     "franchiseePreviewOpenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL';

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "loiVersionId" TEXT NOT NULL,
    "signerRole" "EsignSignerRole" NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "pdfSha256" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "OtpChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoiAcceptance" (
    "id" TEXT NOT NULL,
    "loiVersionId" TEXT NOT NULL,
    "signerRole" "EsignSignerRole" NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "otpChallengeId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "pdfSha256" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentTextVersion" INTEGER NOT NULL,
    "previewOpenedAt" TIMESTAMP(3),
    "method" TEXT NOT NULL DEFAULT 'SMS_OTP',

    CONSTRAINT "LoiAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpChallenge_onboardingId_idx" ON "OtpChallenge"("onboardingId");

-- CreateIndex
CREATE INDEX "OtpChallenge_loiVersionId_idx" ON "OtpChallenge"("loiVersionId");

-- CreateIndex
CREATE INDEX "OtpChallenge_signerUserId_idx" ON "OtpChallenge"("signerUserId");

-- CreateIndex
CREATE INDEX "OtpChallenge_loiVersionId_signerRole_status_idx" ON "OtpChallenge"("loiVersionId", "signerRole", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoiAcceptance_otpChallengeId_key" ON "LoiAcceptance"("otpChallengeId");

-- CreateIndex
CREATE UNIQUE INDEX "LoiAcceptance_loiVersionId_signerRole_key" ON "LoiAcceptance"("loiVersionId", "signerRole");

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_loiVersionId_fkey" FOREIGN KEY ("loiVersionId") REFERENCES "LoiVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiAcceptance" ADD CONSTRAINT "LoiAcceptance_loiVersionId_fkey" FOREIGN KEY ("loiVersionId") REFERENCES "LoiVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiAcceptance" ADD CONSTRAINT "LoiAcceptance_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiAcceptance" ADD CONSTRAINT "LoiAcceptance_otpChallengeId_fkey" FOREIGN KEY ("otpChallengeId") REFERENCES "OtpChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
