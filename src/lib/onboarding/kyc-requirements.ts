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
  // plan.md 20C — optional for both entity types until Sushant ji says
  // which are mandatory (section 20 "NOT DECIDED YET" #3).
  ADDRESS_PROOF: "Address proof",
  PHOTOGRAPH: "Photograph",
  BANK_STATEMENT: "Bank statement",
  CANCELLED_CHEQUE: "Cancelled cheque",
  GST_CERT: "GST certificate",
  PARTNERSHIP_DEED: "Partnership deed / LLP agreement",
  OTHER_SUPPORTING: "Other supporting document",
};

/**
 * plan.md 20C — the seven new kinds ship optional, not added to
 * KYC_REQUIREMENTS. They're offered as additional, not-required uploads on
 * the franchisee's documents page.
 */
export const OPTIONAL_FILE_KINDS: OnboardingFileKind[] = [
  "ADDRESS_PROOF",
  "PHOTOGRAPH",
  "BANK_STATEMENT",
  "CANCELLED_CHEQUE",
  "GST_CERT",
  "PARTNERSHIP_DEED",
  "OTHER_SUPPORTING",
];

/**
 * plan.md section 17 P1-04 ("every open of an Aadhaar file writes an
 * AuditEvent") widened by 20C: "every new kind gets... the restricted-file
 * rule Aadhaar has... bank statement and cancelled cheque are at least as
 * sensitive as Aadhaar." Open-access itself (owner / KYC_REVIEWER / ADMIN)
 * already applies uniformly to every non-PAYMENT_RECEIPT kind in the
 * download route — this list only controls which kinds additionally write
 * an AuditEvent on every open. PAN/COMPANY_DOC/SIGNATORY_PROOF keep their
 * existing (unaudited-on-open) section 17 behaviour unchanged.
 */
export const AUDITED_ON_OPEN_KINDS: OnboardingFileKind[] = [
  "AADHAAR",
  "ADDRESS_PROOF",
  "PHOTOGRAPH",
  "BANK_STATEMENT",
  "CANCELLED_CHEQUE",
  "GST_CERT",
  "PARTNERSHIP_DEED",
  "OTHER_SUPPORTING",
];

export function requiredKycFileKinds(entityType: OnboardingEntityType): OnboardingFileKind[] {
  return KYC_REQUIREMENTS[entityType];
}
