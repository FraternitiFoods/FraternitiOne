-- CreateEnum
CREATE TYPE "OnboardingAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('AWAITING_KYC_PAYMENT', 'UNDER_REVIEW', 'CORRECTIONS_REQUESTED', 'READY_FOR_SIGNATURE', 'FRANCHISE_SIGNED', 'LOI_COMPLETE');

-- CreateEnum
CREATE TYPE "OnboardingEntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('MISSING', 'SUBMITTED', 'CHANGES_REQUESTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "OnboardingFileKind" AS ENUM ('PAN', 'AADHAAR', 'COMPANY_DOC', 'SIGNATORY_PROOF', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "LoiVersionStatus" AS ENUM ('DRAFT', 'RELEASED', 'SENT_FOR_SIGNING', 'FRANCHISE_SIGNED', 'SIGNED', 'VOID');

-- CreateEnum
CREATE TYPE "EsignSignerRole" AS ENUM ('FRANCHISEE', 'COMPANY');

-- CreateEnum
CREATE TYPE "EsignAttemptStatus" AS ENUM ('NOT_STARTED', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EsignProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED_LATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'KYC_REVIEWER';
ALTER TYPE "Role" ADD VALUE 'LOI_PREPARER';
ALTER TYPE "Role" ADD VALUE 'COMPANY_SIGNATORY';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "onboardingId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loginLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StoreOnboarding" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "reservedProjectId" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'Tulsi',
    "format" TEXT NOT NULL,
    "proposedLocation" TEXT NOT NULL,
    "legalApplicantName" TEXT NOT NULL,
    "entityType" "OnboardingEntityType" NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "workspaceEmail" TEXT NOT NULL,
    "invitationEmail" TEXT,
    "franchiseeUserId" TEXT NOT NULL,
    "salesOwnerId" TEXT NOT NULL,
    "accountStatus" "OnboardingAccountStatus" NOT NULL DEFAULT 'INVITED',
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'AWAITING_KYC_PAYMENT',
    "kycStatus" "ReviewStatus" NOT NULL DEFAULT 'MISSING',
    "paymentStatus" "ReviewStatus" NOT NULL DEFAULT 'MISSING',
    "expectedAmount" INTEGER NOT NULL,
    "currentLoiVersionId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingFile" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "kind" "OnboardingFileKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "b2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanError" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycSubmission" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "panNumberEncrypted" TEXT,
    "panName" TEXT,
    "aadhaarHolderName" TEXT,
    "aadhaarLast4" TEXT,
    "companyName" TEXT,
    "companyPan" TEXT,
    "authorisedSignatoryName" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'MISSING',
    "reviewerId" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSubmission" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "declaredAmount" INTEGER NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "utr" TEXT NOT NULL,
    "receiptFileId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "verifiedAmount" INTEGER,
    "verifiedDate" TIMESTAMP(3),
    "bankReference" TEXT,
    "accountsActorId" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoiTemplate" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requiredFields" JSONB NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoiVersion" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "versionNo" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "pdfB2Key" TEXT NOT NULL,
    "pdfSha256" TEXT NOT NULL,
    "status" "LoiVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "signedPdfB2Key" TEXT,
    "signedPdfSha256" TEXT,
    "certificateB2Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoiVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignAttempt" (
    "id" TEXT NOT NULL,
    "loiVersionId" TEXT NOT NULL,
    "signerRole" "EsignSignerRole" NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEnvelopeId" TEXT,
    "pdfSha256" TEXT NOT NULL,
    "status" "EsignAttemptStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "signerUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "processingStatus" "EsignProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "onboardingId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_seq_key" ON "StoreOnboarding"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_reservedProjectId_key" ON "StoreOnboarding"("reservedProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_workspaceEmail_key" ON "StoreOnboarding"("workspaceEmail");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_franchiseeUserId_key" ON "StoreOnboarding"("franchiseeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_currentLoiVersionId_key" ON "StoreOnboarding"("currentLoiVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOnboarding_projectId_key" ON "StoreOnboarding"("projectId");

-- CreateIndex
CREATE INDEX "StoreOnboarding_franchiseeUserId_idx" ON "StoreOnboarding"("franchiseeUserId");

-- CreateIndex
CREATE INDEX "StoreOnboarding_salesOwnerId_idx" ON "StoreOnboarding"("salesOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingFile_supersedesId_key" ON "OnboardingFile"("supersedesId");

-- CreateIndex
CREATE INDEX "OnboardingFile_onboardingId_idx" ON "OnboardingFile"("onboardingId");

-- CreateIndex
CREATE INDEX "OnboardingFile_kind_idx" ON "OnboardingFile"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "KycSubmission_onboardingId_key" ON "KycSubmission"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSubmission_receiptFileId_key" ON "PaymentSubmission"("receiptFileId");

-- CreateIndex
CREATE INDEX "PaymentSubmission_onboardingId_idx" ON "PaymentSubmission"("onboardingId");

-- CreateIndex
CREATE INDEX "PaymentSubmission_utr_idx" ON "PaymentSubmission"("utr");

-- CreateIndex
CREATE UNIQUE INDEX "LoiTemplate_name_version_key" ON "LoiTemplate"("name", "version");

-- CreateIndex
CREATE INDEX "LoiVersion_onboardingId_idx" ON "LoiVersion"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "LoiVersion_onboardingId_versionNo_key" ON "LoiVersion"("onboardingId", "versionNo");

-- CreateIndex
CREATE INDEX "EsignAttempt_loiVersionId_idx" ON "EsignAttempt"("loiVersionId");

-- CreateIndex
CREATE INDEX "EsignAttempt_providerEnvelopeId_idx" ON "EsignAttempt"("providerEnvelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "EsignAttempt_loiVersionId_signerRole_attemptNo_key" ON "EsignAttempt"("loiVersionId", "signerRole", "attemptNo");

-- CreateIndex
CREATE INDEX "EsignEvent_envelopeId_idx" ON "EsignEvent"("envelopeId");

-- CreateIndex
CREATE INDEX "EsignEvent_attemptId_idx" ON "EsignEvent"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "EsignEvent_provider_providerEventId_key" ON "EsignEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "NotificationLog_onboardingId_idx" ON "NotificationLog"("onboardingId");

-- CreateIndex
CREATE INDEX "AuditEvent_onboardingId_idx" ON "AuditEvent"("onboardingId");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOnboarding" ADD CONSTRAINT "StoreOnboarding_franchiseeUserId_fkey" FOREIGN KEY ("franchiseeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOnboarding" ADD CONSTRAINT "StoreOnboarding_salesOwnerId_fkey" FOREIGN KEY ("salesOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOnboarding" ADD CONSTRAINT "StoreOnboarding_currentLoiVersionId_fkey" FOREIGN KEY ("currentLoiVersionId") REFERENCES "LoiVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOnboarding" ADD CONSTRAINT "StoreOnboarding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FranchiseProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingFile" ADD CONSTRAINT "OnboardingFile_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingFile" ADD CONSTRAINT "OnboardingFile_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "OnboardingFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingFile" ADD CONSTRAINT "OnboardingFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "OnboardingFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_accountsActorId_fkey" FOREIGN KEY ("accountsActorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiVersion" ADD CONSTRAINT "LoiVersion_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "StoreOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiVersion" ADD CONSTRAINT "LoiVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LoiTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoiVersion" ADD CONSTRAINT "LoiVersion_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignAttempt" ADD CONSTRAINT "EsignAttempt_loiVersionId_fkey" FOREIGN KEY ("loiVersionId") REFERENCES "LoiVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignAttempt" ADD CONSTRAINT "EsignAttempt_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignEvent" ADD CONSTRAINT "EsignEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "EsignAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

