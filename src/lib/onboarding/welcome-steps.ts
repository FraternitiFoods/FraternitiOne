/**
 * Welcome page "Next steps" checklist. Pure and client-safe (no db, no
 * `server-only`) so it is unit-testable and the chat prompt can reuse the same
 * step wording. It only maps the existing `OnboardingStatus` onto four
 * franchisee-facing steps; it does not add any new state.
 *
 * CORRECTIONS_REQUESTED sits at step 0 on purpose: the franchisee has to act on
 * their documents again, so "what do I do now?" is the upload page. (The
 * Progress page draws it at the review pill instead; that page answers "where
 * is my application", this one answers "what do I do".)
 */
import type { OnboardingStatus } from "@prisma/client";

export type WelcomeStep = { key: string; title: string; description: string };

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    key: "documents",
    title: "Submit your KYC documents and payment receipt",
    description: "Upload the required documents and the LOI fee receipt.",
  },
  {
    key: "review",
    title: "We review your submission",
    description: "Our team checks your documents and payment. You'll get an email once it's decided.",
  },
  {
    key: "sign",
    title: "Review and e-sign your LOI",
    description: "Read your Letter of Intent and sign it with Aadhaar e-sign.",
  },
  {
    key: "countersign",
    title: "Company countersigns",
    description: "Once the company signs too, your LOI is complete and your project is created.",
  },
];

/** Index of the step the franchisee is on; `WELCOME_STEPS.length` means every step is done. */
export function currentWelcomeStepIndex(status: OnboardingStatus): number {
  switch (status) {
    case "AWAITING_KYC_PAYMENT":
    case "CORRECTIONS_REQUESTED":
      return 0;
    case "UNDER_REVIEW":
      return 1;
    case "READY_FOR_SIGNATURE":
      return 2;
    case "FRANCHISE_SIGNED":
      return 3;
    case "LOI_COMPLETE":
      return WELCOME_STEPS.length;
  }
}

/** The one button under the checklist: where the franchisee should go right now. */
export function welcomeAction(status: OnboardingStatus): { href: string; label: string } {
  switch (status) {
    case "AWAITING_KYC_PAYMENT":
      return { href: "/onboarding/documents", label: "Upload your documents" };
    case "CORRECTIONS_REQUESTED":
      return { href: "/onboarding/documents", label: "Fix your documents" };
    case "READY_FOR_SIGNATURE":
      return { href: "/onboarding/loi", label: "Review and sign your LOI" };
    case "FRANCHISE_SIGNED":
      return { href: "/onboarding/loi", label: "View your LOI" };
    case "UNDER_REVIEW":
    case "LOI_COMPLETE":
      return { href: "/onboarding", label: "See your progress" };
  }
}
