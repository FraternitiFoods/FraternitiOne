/**
 * plan.md section 17 — the single source of truth for every onboarding state
 * transition and every sign/complete gate. UI never sets a status directly;
 * server actions call these functions, which either return the next state or
 * throw InvalidTransitionError. No `server-only` import here on purpose —
 * this module is pure (no DB, no I/O) so it can be unit-tested directly
 * (see state.test.ts) and imported from both server actions and UI code that
 * needs to show/hide a button.
 */
import type {
  OnboardingAccountStatus,
  OnboardingStatus,
  ReviewStatus,
  LoiVersionStatus,
  EsignAttemptStatus,
} from "@prisma/client";

export class InvalidTransitionError extends Error {
  constructor(machine: string, from: string, event: string) {
    super(`${machine}: cannot apply "${event}" from state "${from}".`);
    this.name = "InvalidTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Account status: INVITED -> ACTIVE -> SUSPENDED (and back to ACTIVE).
// ---------------------------------------------------------------------------

export type AccountEvent = "ACTIVATE" | "SUSPEND" | "REACTIVATE";

const ACCOUNT_TRANSITIONS: Record<OnboardingAccountStatus, Partial<Record<AccountEvent, OnboardingAccountStatus>>> = {
  INVITED: { ACTIVATE: "ACTIVE" },
  ACTIVE: { SUSPEND: "SUSPENDED" },
  SUSPENDED: { REACTIVATE: "ACTIVE" },
};

export function transitionAccount(
  current: OnboardingAccountStatus,
  event: AccountEvent
): OnboardingAccountStatus {
  const next = ACCOUNT_TRANSITIONS[current]?.[event];
  if (!next) throw new InvalidTransitionError("Account", current, event);
  return next;
}

// ---------------------------------------------------------------------------
// Review status — shared shape for KYC and Payment (section 17: "KYC and
// Payment review (independent)"): MISSING -> SUBMITTED ->
// (CHANGES_REQUESTED | ACCEPTED); CHANGES_REQUESTED -> SUBMITTED.
// REOPEN is the fee-change rule (section 17, point 12): an ACCEPTED payment
// can be forced back to SUBMITTED when expectedAmount rises above
// verifiedAmount — not a franchisee resubmission, an Accounts/system event.
// ---------------------------------------------------------------------------

export type ReviewEvent = "SUBMIT" | "REQUEST_CHANGES" | "ACCEPT" | "REOPEN";

const REVIEW_TRANSITIONS: Record<ReviewStatus, Partial<Record<ReviewEvent, ReviewStatus>>> = {
  MISSING: { SUBMIT: "SUBMITTED" },
  SUBMITTED: { REQUEST_CHANGES: "CHANGES_REQUESTED", ACCEPT: "ACCEPTED" },
  CHANGES_REQUESTED: { SUBMIT: "SUBMITTED" },
  ACCEPTED: { REOPEN: "SUBMITTED" },
};

export function transitionReview(current: ReviewStatus, event: ReviewEvent): ReviewStatus {
  const next = REVIEW_TRANSITIONS[current]?.[event];
  if (!next) throw new InvalidTransitionError("Review", current, event);
  return next;
}

// ---------------------------------------------------------------------------
// LOI version status: DRAFT -> RELEASED -> SENT_FOR_SIGNING ->
// FRANCHISE_SIGNED -> SIGNED. VOID is reachable from any non-terminal state
// (superseded by a new version, section 17 point 11).
// ---------------------------------------------------------------------------

export type LoiEvent = "RELEASE" | "SEND_FOR_SIGNING" | "FRANCHISE_SIGN" | "COMPANY_SIGN" | "VOID";

const LOI_TRANSITIONS: Record<LoiVersionStatus, Partial<Record<LoiEvent, LoiVersionStatus>>> = {
  DRAFT: { RELEASE: "RELEASED", VOID: "VOID" },
  RELEASED: { SEND_FOR_SIGNING: "SENT_FOR_SIGNING", VOID: "VOID" },
  SENT_FOR_SIGNING: { FRANCHISE_SIGN: "FRANCHISE_SIGNED", VOID: "VOID" },
  FRANCHISE_SIGNED: { COMPANY_SIGN: "SIGNED", VOID: "VOID" },
  SIGNED: {},
  VOID: {},
};

export function transitionLoiVersion(current: LoiVersionStatus, event: LoiEvent): LoiVersionStatus {
  const next = LOI_TRANSITIONS[current]?.[event];
  if (!next) throw new InvalidTransitionError("LoiVersion", current, event);
  return next;
}

// ---------------------------------------------------------------------------
// E-sign attempt: NOT_STARTED -> SENT -> IN_PROGRESS -> COMPLETED, or
// FAILED / EXPIRED / CANCELLED. A failed/expired/cancelled attempt is never
// resurrected — a fresh attempt (attemptNo + 1) is created instead.
// ---------------------------------------------------------------------------

export type EsignAttemptEvent = "SEND" | "PROVIDER_START" | "COMPLETE" | "FAIL" | "EXPIRE" | "CANCEL";

const ESIGN_ATTEMPT_TRANSITIONS: Record<
  EsignAttemptStatus,
  Partial<Record<EsignAttemptEvent, EsignAttemptStatus>>
> = {
  NOT_STARTED: { SEND: "SENT" },
  SENT: { PROVIDER_START: "IN_PROGRESS", COMPLETE: "COMPLETED", FAIL: "FAILED", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  IN_PROGRESS: { COMPLETE: "COMPLETED", FAIL: "FAILED", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  COMPLETED: {},
  FAILED: {},
  EXPIRED: {},
  CANCELLED: {},
};

export function transitionEsignAttempt(
  current: EsignAttemptStatus,
  event: EsignAttemptEvent
): EsignAttemptStatus {
  const next = ESIGN_ATTEMPT_TRANSITIONS[current]?.[event];
  if (!next) throw new InvalidTransitionError("EsignAttempt", current, event);
  return next;
}

// ---------------------------------------------------------------------------
// Onboarding status — derived, not event-driven (section 17: "READY_FOR_
// SIGNATURE is derived: kyc ACCEPTED && payment ACCEPTED && LOI released").
// Folding franchise/company-sign completion into the same derivation keeps
// exactly one function answering "what should the top-level status be right
// now", instead of a second parallel state machine that could disagree with
// this one.
// ---------------------------------------------------------------------------

export type OnboardingStatusInput = {
  kycStatus: ReviewStatus;
  paymentStatus: ReviewStatus;
  verifiedAmount: number | null;
  expectedAmount: number;
  loiVersionStatus: LoiVersionStatus | null;
  franchiseSignCompleted: boolean;
  companySignCompleted: boolean;
  /** True once conversion has actually run — see conversion.ts. */
  isConverted: boolean;
};

export function deriveOnboardingStatus(input: OnboardingStatusInput): OnboardingStatus {
  if (input.isConverted) return "LOI_COMPLETE";
  if (input.companySignCompleted) return "FRANCHISE_SIGNED"; // conversion hasn't run yet — see conversion.ts
  if (input.franchiseSignCompleted) return "FRANCHISE_SIGNED";

  const loiReleased =
    input.loiVersionStatus === "RELEASED" ||
    input.loiVersionStatus === "SENT_FOR_SIGNING" ||
    input.loiVersionStatus === "FRANCHISE_SIGNED";

  const paymentSufficient =
    input.paymentStatus === "ACCEPTED" &&
    input.verifiedAmount !== null &&
    input.verifiedAmount >= input.expectedAmount;

  if (input.kycStatus === "ACCEPTED" && paymentSufficient && loiReleased) {
    return "READY_FOR_SIGNATURE";
  }

  if (input.kycStatus === "CHANGES_REQUESTED" || input.paymentStatus === "CHANGES_REQUESTED") {
    return "CORRECTIONS_REQUESTED";
  }

  if (input.kycStatus === "MISSING" && input.paymentStatus === "MISSING") {
    return "AWAITING_KYC_PAYMENT";
  }

  return "UNDER_REVIEW";
}

// ---------------------------------------------------------------------------
// Gate functions (section 17's own pseudocode names were canFranchiseSign/
// canCompanySign — renamed *Now here to avoid colliding with
// permissions.ts's role-only canCompanySign(user), which checks "does this
// role exist" not "is this specific sign allowed right now"). Both are pure
// and take exactly the fields they need, so a server action and a page can
// call the identical function without re-deriving the logic.
// ---------------------------------------------------------------------------

export type FranchiseSignGateInput = {
  kycStatus: ReviewStatus;
  paymentStatus: ReviewStatus;
  verifiedAmount: number | null;
  expectedAmount: number;
  loiVersionStatus: LoiVersionStatus | null;
  /** Latest FRANCHISEE attempt on the current LOI version, if any. */
  latestFranchiseAttemptStatus: EsignAttemptStatus | null;
};

/** P1-07: kyc ACCEPTED ∧ payment ACCEPTED ∧ verifiedAmount ≥ expectedAmount ∧ LOI RELEASED ∧ no open attempt. */
export function canFranchiseeSignNow(input: FranchiseSignGateInput): boolean {
  if (input.kycStatus !== "ACCEPTED") return false;
  if (input.paymentStatus !== "ACCEPTED") return false;
  if (input.verifiedAmount === null || input.verifiedAmount < input.expectedAmount) return false;
  if (input.loiVersionStatus !== "RELEASED" && input.loiVersionStatus !== "SENT_FOR_SIGNING") return false;
  const openStatuses: EsignAttemptStatus[] = ["SENT", "IN_PROGRESS", "COMPLETED"];
  if (input.latestFranchiseAttemptStatus && openStatuses.includes(input.latestFranchiseAttemptStatus)) {
    return false;
  }
  return true;
}

export type CompanySignGateInput = {
  actorRole: string;
  /** The franchisee attempt on the SAME loiVersionId. */
  franchiseAttempt: { status: EsignAttemptStatus; loiVersionId: string; pdfSha256: string } | null;
  /** The current LOI version being signed. */
  loiVersion: { id: string; pdfSha256: string };
  latestCompanyAttemptStatus: EsignAttemptStatus | null;
};

/** P1-08: franchisee COMPLETED on the same version+hash ∧ actor role COMPANY_SIGNATORY ∧ no open company attempt. */
export function canCompanySignNow(input: CompanySignGateInput): boolean {
  if (input.actorRole !== "COMPANY_SIGNATORY") return false;
  if (!input.franchiseAttempt) return false;
  if (input.franchiseAttempt.status !== "COMPLETED") return false;
  if (input.franchiseAttempt.loiVersionId !== input.loiVersion.id) return false;
  if (input.franchiseAttempt.pdfSha256 !== input.loiVersion.pdfSha256) return false;
  const openStatuses: EsignAttemptStatus[] = ["SENT", "IN_PROGRESS", "COMPLETED"];
  if (input.latestCompanyAttemptStatus && openStatuses.includes(input.latestCompanyAttemptStatus)) {
    return false;
  }
  return true;
}
