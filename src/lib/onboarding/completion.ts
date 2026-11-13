/**
 * plan.md section 20B — "Onboarding completion: x of y required items
 * submitted". Deliberately NOT a percentage of profile fields (name/phone/
 * location are filled at creation, so that would read ~100% on day one and
 * mean nothing per the section's own note) — this counts the exact same
 * requirements `submitKycForReview` (src/app/onboarding/documents/actions.ts)
 * already enforces before it lets KYC move to SUBMITTED, plus the required
 * document kinds from kyc-requirements.ts's `requiredKycFileKinds`, plus
 * payment proof. Kept as a pure function (no `server-only`, no db import) so
 * it's unit-testable and reusable from both /onboarding and /dashboard
 * without either page re-deriving the rules.
 */
import type { OnboardingEntityType, OnboardingFileKind, ReviewStatus } from "@prisma/client";
import { requiredKycFileKinds } from "./kyc-requirements";

export type CompletionKycFields = {
  panNumberEncrypted: string | null;
  panName: string | null;
  aadhaarHolderName: string | null;
  aadhaarLast4: string | null;
  companyName: string | null;
  companyPan: string | null;
  authorisedSignatoryName: string | null;
} | null;

export type CompletionInput = {
  entityType: OnboardingEntityType;
  kyc: CompletionKycFields;
  /** Kinds with at least one (latest-version) OnboardingFile uploaded. */
  uploadedFileKinds: OnboardingFileKind[];
  paymentStatus: ReviewStatus;
};

export type CompletionItem = { key: string; label: string; done: boolean };

export type CompletionResult = {
  items: CompletionItem[];
  completed: number;
  total: number;
};

export function computeOnboardingCompletion(input: CompletionInput): CompletionResult {
  const kyc = input.kyc;
  const items: CompletionItem[] = [];

  // Same two fields required for every entity type (submitKycForReview).
  items.push({ key: "pan_number", label: "PAN number", done: Boolean(kyc?.panNumberEncrypted) });
  items.push({ key: "pan_name", label: "PAN holder name", done: Boolean(kyc?.panName) });

  if (input.entityType === "INDIVIDUAL") {
    items.push({
      key: "aadhaar_holder_name",
      label: "Aadhaar holder name",
      done: Boolean(kyc?.aadhaarHolderName),
    });
    items.push({
      key: "aadhaar_last4",
      label: "Aadhaar last 4 digits",
      done: Boolean(kyc?.aadhaarLast4),
    });
  } else {
    items.push({ key: "company_name", label: "Company name", done: Boolean(kyc?.companyName) });
    items.push({ key: "company_pan", label: "Company PAN", done: Boolean(kyc?.companyPan) });
    items.push({
      key: "authorised_signatory",
      label: "Authorised signatory name",
      done: Boolean(kyc?.authorisedSignatoryName),
    });
  }

  const uploaded = new Set(input.uploadedFileKinds);
  for (const kind of requiredKycFileKinds(input.entityType)) {
    items.push({ key: `doc_${kind}`, label: kind, done: uploaded.has(kind) });
  }

  items.push({
    key: "payment_proof",
    label: "Payment proof",
    done: input.paymentStatus !== "MISSING",
  });

  const completed = items.filter((i) => i.done).length;
  return { items, completed, total: items.length };
}
