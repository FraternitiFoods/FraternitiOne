/**
 * plan.md section 17, "NOT DECIDED YET" item 3 — working default: which KYC
 * documents are required per entity type. Kept in one file, not scattered
 * through review-queue/upload code, so the actual approved list can be
 * dropped in later without touching call sites.
 */
import type { OnboardingEntityType, OnboardingFileKind } from "@prisma/client";

export const KYC_REQUIREMENTS: Record<OnboardingEntityType, OnboardingFileKind[]> = {
  INDIVIDUAL: ["PAN", "AADHAAR"],
  COMPANY: ["PAN", "AADHAAR", "COMPANY_DOC", "SIGNATORY_PROOF"],
};

export const FILE_KIND_LABELS: Record<OnboardingFileKind, string> = {
  PAN: "PAN card",
  AADHAAR: "Aadhaar card",
  COMPANY_DOC: "Certificate of incorporation",
  SIGNATORY_PROOF: "Board resolution / authorisation letter",
  PAYMENT_RECEIPT: "Payment receipt",
};

export function requiredKycFileKinds(entityType: OnboardingEntityType): OnboardingFileKind[] {
  return KYC_REQUIREMENTS[entityType];
}
