import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  transitionAccount,
  transitionReview,
  transitionLoiVersion,
  transitionEsignAttempt,
  deriveOnboardingStatus,
  canFranchiseeSignNow,
  canCompanySignNow,
  type AccountEvent,
  type ReviewEvent,
  type LoiEvent,
  type EsignAttemptEvent,
} from "./state";
import type {
  OnboardingAccountStatus,
  ReviewStatus,
  LoiVersionStatus,
  EsignAttemptStatus,
} from "@prisma/client";

const ACCOUNT_STATES: OnboardingAccountStatus[] = ["INVITED", "ACTIVE", "SUSPENDED"];
const ACCOUNT_EVENTS: AccountEvent[] = ["ACTIVATE", "SUSPEND", "REACTIVATE"];
const ACCOUNT_ALLOWED: Record<string, OnboardingAccountStatus> = {
  "INVITED:ACTIVATE": "ACTIVE",
  "ACTIVE:SUSPEND": "SUSPENDED",
  "SUSPENDED:REACTIVATE": "ACTIVE",
};

describe("transitionAccount", () => {
  for (const from of ACCOUNT_STATES) {
    for (const event of ACCOUNT_EVENTS) {
      const key = `${from}:${event}`;
      const expected = ACCOUNT_ALLOWED[key];
      if (expected) {
        it(`allows ${key} -> ${expected}`, () => {
          expect(transitionAccount(from, event)).toBe(expected);
        });
      } else {
        it(`forbids ${key}`, () => {
          expect(() => transitionAccount(from, event)).toThrow(InvalidTransitionError);
        });
      }
    }
  }
});

const REVIEW_STATES: ReviewStatus[] = ["MISSING", "SUBMITTED", "CHANGES_REQUESTED", "ACCEPTED"];
const REVIEW_EVENTS: ReviewEvent[] = ["SUBMIT", "REQUEST_CHANGES", "ACCEPT", "REOPEN"];
const REVIEW_ALLOWED: Record<string, ReviewStatus> = {
  "MISSING:SUBMIT": "SUBMITTED",
  "SUBMITTED:REQUEST_CHANGES": "CHANGES_REQUESTED",
  "SUBMITTED:ACCEPT": "ACCEPTED",
  "CHANGES_REQUESTED:SUBMIT": "SUBMITTED",
  "ACCEPTED:REOPEN": "SUBMITTED",
};

describe("transitionReview (shared KYC/Payment shape)", () => {
  for (const from of REVIEW_STATES) {
    for (const event of REVIEW_EVENTS) {
      const key = `${from}:${event}`;
      const expected = REVIEW_ALLOWED[key];
      if (expected) {
        it(`allows ${key} -> ${expected}`, () => {
          expect(transitionReview(from, event)).toBe(expected);
        });
      } else {
        it(`forbids ${key}`, () => {
          expect(() => transitionReview(from, event)).toThrow(InvalidTransitionError);
        });
      }
    }
  }
});

const LOI_STATES: LoiVersionStatus[] = [
  "DRAFT",
  "RELEASED",
  "SENT_FOR_SIGNING",
  "FRANCHISE_SIGNED",
  "SIGNED",
  "VOID",
];
const LOI_EVENTS: LoiEvent[] = ["RELEASE", "SEND_FOR_SIGNING", "FRANCHISE_SIGN", "COMPANY_SIGN", "VOID"];
const LOI_ALLOWED: Record<string, LoiVersionStatus> = {
  "DRAFT:RELEASE": "RELEASED",
  "DRAFT:VOID": "VOID",
  "RELEASED:SEND_FOR_SIGNING": "SENT_FOR_SIGNING",
  "RELEASED:VOID": "VOID",
  "SENT_FOR_SIGNING:FRANCHISE_SIGN": "FRANCHISE_SIGNED",
  "SENT_FOR_SIGNING:VOID": "VOID",
  "FRANCHISE_SIGNED:COMPANY_SIGN": "SIGNED",
  "FRANCHISE_SIGNED:VOID": "VOID",
};

describe("transitionLoiVersion", () => {
  for (const from of LOI_STATES) {
    for (const event of LOI_EVENTS) {
      const key = `${from}:${event}`;
      const expected = LOI_ALLOWED[key];
      if (expected) {
        it(`allows ${key} -> ${expected}`, () => {
          expect(transitionLoiVersion(from, event)).toBe(expected);
        });
      } else {
        it(`forbids ${key}`, () => {
          expect(() => transitionLoiVersion(from, event)).toThrow(InvalidTransitionError);
        });
      }
    }
  }
});

const ESIGN_STATES: EsignAttemptStatus[] = [
  "NOT_STARTED",
  "SENT",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
];
const ESIGN_EVENTS: EsignAttemptEvent[] = ["SEND", "PROVIDER_START", "COMPLETE", "FAIL", "EXPIRE", "CANCEL"];
const ESIGN_ALLOWED: Record<string, EsignAttemptStatus> = {
  "NOT_STARTED:SEND": "SENT",
  "SENT:PROVIDER_START": "IN_PROGRESS",
  "SENT:COMPLETE": "COMPLETED",
  "SENT:FAIL": "FAILED",
  "SENT:EXPIRE": "EXPIRED",
  "SENT:CANCEL": "CANCELLED",
  "IN_PROGRESS:COMPLETE": "COMPLETED",
  "IN_PROGRESS:FAIL": "FAILED",
  "IN_PROGRESS:EXPIRE": "EXPIRED",
  "IN_PROGRESS:CANCEL": "CANCELLED",
};

describe("transitionEsignAttempt", () => {
  for (const from of ESIGN_STATES) {
    for (const event of ESIGN_EVENTS) {
      const key = `${from}:${event}`;
      const expected = ESIGN_ALLOWED[key];
      if (expected) {
        it(`allows ${key} -> ${expected}`, () => {
          expect(transitionEsignAttempt(from, event)).toBe(expected);
        });
      } else {
        it(`forbids ${key}`, () => {
          expect(() => transitionEsignAttempt(from, event)).toThrow(InvalidTransitionError);
        });
      }
    }
  }
});

describe("deriveOnboardingStatus", () => {
  const base = {
    kycStatus: "MISSING" as ReviewStatus,
    paymentStatus: "MISSING" as ReviewStatus,
    verifiedAmount: null as number | null,
    expectedAmount: 100000,
    loiVersionStatus: null as LoiVersionStatus | null,
    franchiseSignCompleted: false,
    companySignCompleted: false,
    isConverted: false,
  };

  it("starts AWAITING_KYC_PAYMENT when nothing submitted", () => {
    expect(deriveOnboardingStatus(base)).toBe("AWAITING_KYC_PAYMENT");
  });

  it("moves to UNDER_REVIEW once either track is submitted", () => {
    expect(deriveOnboardingStatus({ ...base, kycStatus: "SUBMITTED" })).toBe("UNDER_REVIEW");
  });

  it("moves to CORRECTIONS_REQUESTED when either track needs changes", () => {
    expect(deriveOnboardingStatus({ ...base, kycStatus: "CHANGES_REQUESTED" })).toBe(
      "CORRECTIONS_REQUESTED"
    );
    expect(deriveOnboardingStatus({ ...base, paymentStatus: "CHANGES_REQUESTED" })).toBe(
      "CORRECTIONS_REQUESTED"
    );
  });

  it("is READY_FOR_SIGNATURE only when kyc+payment accepted, amount sufficient, and LOI released", () => {
    const ready = {
      ...base,
      kycStatus: "ACCEPTED" as ReviewStatus,
      paymentStatus: "ACCEPTED" as ReviewStatus,
      verifiedAmount: 100000,
      loiVersionStatus: "RELEASED" as LoiVersionStatus,
    };
    expect(deriveOnboardingStatus(ready)).toBe("READY_FOR_SIGNATURE");
    expect(deriveOnboardingStatus({ ...ready, verifiedAmount: 99999 })).not.toBe("READY_FOR_SIGNATURE");
    expect(deriveOnboardingStatus({ ...ready, loiVersionStatus: "DRAFT" })).not.toBe(
      "READY_FOR_SIGNATURE"
    );
  });

  it("is FRANCHISE_SIGNED once the franchisee has signed, even before company", () => {
    expect(deriveOnboardingStatus({ ...base, franchiseSignCompleted: true })).toBe("FRANCHISE_SIGNED");
  });

  it("stays FRANCHISE_SIGNED after company signs but before conversion runs", () => {
    expect(
      deriveOnboardingStatus({ ...base, franchiseSignCompleted: true, companySignCompleted: true })
    ).toBe("FRANCHISE_SIGNED");
  });

  it("is LOI_COMPLETE once converted", () => {
    expect(
      deriveOnboardingStatus({
        ...base,
        franchiseSignCompleted: true,
        companySignCompleted: true,
        isConverted: true,
      })
    ).toBe("LOI_COMPLETE");
  });

  it("fee-reopen (payment back to SUBMITTED) drops out of READY_FOR_SIGNATURE", () => {
    const reopened = {
      ...base,
      kycStatus: "ACCEPTED" as ReviewStatus,
      paymentStatus: "SUBMITTED" as ReviewStatus,
      verifiedAmount: 100000,
      loiVersionStatus: "RELEASED" as LoiVersionStatus,
    };
    expect(deriveOnboardingStatus(reopened)).toBe("UNDER_REVIEW");
  });
});

describe("canFranchiseeSignNow", () => {
  const ready = {
    kycStatus: "ACCEPTED" as ReviewStatus,
    paymentStatus: "ACCEPTED" as ReviewStatus,
    verifiedAmount: 100000,
    expectedAmount: 100000,
    loiVersionStatus: "RELEASED" as LoiVersionStatus,
    latestFranchiseAttemptStatus: null as EsignAttemptStatus | null,
  };

  it("allows when every gate is satisfied", () => {
    expect(canFranchiseeSignNow(ready)).toBe(true);
  });

  it("blocks when KYC not accepted", () => {
    expect(canFranchiseeSignNow({ ...ready, kycStatus: "SUBMITTED" })).toBe(false);
  });

  it("blocks when payment not accepted", () => {
    expect(canFranchiseeSignNow({ ...ready, paymentStatus: "SUBMITTED" })).toBe(false);
  });

  it("blocks when verified amount is below expected (P1-12 fee-raise case)", () => {
    expect(canFranchiseeSignNow({ ...ready, verifiedAmount: 50000 })).toBe(false);
  });

  it("blocks when verified amount is null", () => {
    expect(canFranchiseeSignNow({ ...ready, verifiedAmount: null })).toBe(false);
  });

  it("blocks when LOI is not released", () => {
    expect(canFranchiseeSignNow({ ...ready, loiVersionStatus: "DRAFT" })).toBe(false);
  });

  it("allows when LOI is SENT_FOR_SIGNING (already handed to provider)", () => {
    expect(canFranchiseeSignNow({ ...ready, loiVersionStatus: "SENT_FOR_SIGNING" })).toBe(true);
  });

  it("blocks when there is already an open attempt", () => {
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "SENT" })).toBe(false);
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "IN_PROGRESS" })).toBe(false);
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "COMPLETED" })).toBe(false);
  });

  it("allows a retry after a failed/expired/cancelled attempt", () => {
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "FAILED" })).toBe(true);
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "EXPIRED" })).toBe(true);
    expect(canFranchiseeSignNow({ ...ready, latestFranchiseAttemptStatus: "CANCELLED" })).toBe(true);
  });
});

describe("canCompanySignNow", () => {
  const loiVersion = { id: "loi-1", pdfSha256: "hash-a" };
  const completedFranchiseAttempt = {
    status: "COMPLETED" as EsignAttemptStatus,
    loiVersionId: "loi-1",
    pdfSha256: "hash-a",
  };

  it("allows when franchisee completed the same version+hash and actor is COMPANY_SIGNATORY", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: completedFranchiseAttempt,
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(true);
  });

  it("blocks a non-COMPANY_SIGNATORY actor", () => {
    expect(
      canCompanySignNow({
        actorRole: "ADMIN",
        franchiseAttempt: completedFranchiseAttempt,
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(false);
  });

  it("blocks when there is no franchisee attempt yet", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: null,
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(false);
  });

  it("blocks when the franchisee attempt isn't COMPLETED yet (company can't sign before franchisee)", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: { ...completedFranchiseAttempt, status: "SENT" },
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(false);
  });

  it("blocks when the franchisee attempt was on a different LOI version (changed terms mid-signing)", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: { ...completedFranchiseAttempt, loiVersionId: "loi-0" },
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(false);
  });

  it("blocks when the franchisee attempt's hash doesn't match the current version's hash", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: { ...completedFranchiseAttempt, pdfSha256: "hash-b" },
        loiVersion,
        latestCompanyAttemptStatus: null,
      })
    ).toBe(false);
  });

  it("blocks when there is already an open/completed company attempt", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: completedFranchiseAttempt,
        loiVersion,
        latestCompanyAttemptStatus: "IN_PROGRESS",
      })
    ).toBe(false);
  });

  it("allows a retry after a failed company attempt", () => {
    expect(
      canCompanySignNow({
        actorRole: "COMPANY_SIGNATORY",
        franchiseAttempt: completedFranchiseAttempt,
        loiVersion,
        latestCompanyAttemptStatus: "FAILED",
      })
    ).toBe(true);
  });
});
