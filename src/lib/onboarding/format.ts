import type {
  OnboardingAccountStatus,
  OnboardingStatus,
  ReviewStatus,
  OnboardingEntityType,
  LoiVersionStatus,
  EsignAttemptStatus,
} from "@prisma/client";

export function formatMoney(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatDateOnly(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const ONBOARDING_ACCOUNT_STATUS_LABELS: Record<OnboardingAccountStatus, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
};

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  AWAITING_KYC_PAYMENT: "Awaiting KYC & Payment",
  UNDER_REVIEW: "Under Review",
  CORRECTIONS_REQUESTED: "Corrections Requested",
  READY_FOR_SIGNATURE: "Ready for Signature",
  FRANCHISE_SIGNED: "Franchisee Signed",
  LOI_COMPLETE: "LOI Complete",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  MISSING: "Missing",
  SUBMITTED: "Submitted",
  CHANGES_REQUESTED: "Changes Requested",
  ACCEPTED: "Accepted",
};

export const ENTITY_TYPE_LABELS: Record<OnboardingEntityType, string> = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
};

export const LOI_VERSION_STATUS_LABELS: Record<LoiVersionStatus, string> = {
  DRAFT: "Draft",
  RELEASED: "Released",
  SENT_FOR_SIGNING: "Sent for Signing",
  FRANCHISE_SIGNED: "Franchisee Signed",
  SIGNED: "Fully Signed",
  VOID: "Void",
};

export const ESIGN_ATTEMPT_STATUS_LABELS: Record<EsignAttemptStatus, string> = {
  NOT_STARTED: "Not Started",
  SENT: "Sent",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/** Franchise-home "next action" copy — one line, no drill-down needed to know what's next. */
export function nextActionLabel(o: {
  onboardingStatus: OnboardingStatus;
  kycStatus: ReviewStatus;
  paymentStatus: ReviewStatus;
}): string {
  switch (o.onboardingStatus) {
    case "AWAITING_KYC_PAYMENT":
      return "Upload your KYC documents and payment receipt to get started.";
    case "CORRECTIONS_REQUESTED":
      if (o.kycStatus === "CHANGES_REQUESTED" && o.paymentStatus === "CHANGES_REQUESTED") {
        return "Re-upload your KYC documents and payment receipt — see the reasons below.";
      }
      if (o.kycStatus === "CHANGES_REQUESTED") return "Re-upload your KYC documents — see the reason below.";
      return "Re-upload your payment receipt — see the reason below.";
    case "UNDER_REVIEW":
      return "Your documents are under review. We'll notify you once a decision is made.";
    case "READY_FOR_SIGNATURE":
      return "Your LOI is ready — proceed to Aadhaar e-sign.";
    case "FRANCHISE_SIGNED":
      return "Waiting for the company signatory to countersign.";
    case "LOI_COMPLETE":
      return "LOI complete — your project has been created.";
    default:
      return "";
  }
}
