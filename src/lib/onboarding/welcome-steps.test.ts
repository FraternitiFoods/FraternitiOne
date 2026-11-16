import { describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { WELCOME_STEPS, currentWelcomeStepIndex, welcomeAction } from "./welcome-steps";

const ALL: OnboardingStatus[] = [
  "AWAITING_KYC_PAYMENT",
  "UNDER_REVIEW",
  "CORRECTIONS_REQUESTED",
  "READY_FOR_SIGNATURE",
  "FRANCHISE_SIGNED",
  "LOI_COMPLETE",
];

describe("welcome-steps", () => {
  it("maps every status to a step index inside 0..steps.length", () => {
    for (const s of ALL) {
      const i = currentWelcomeStepIndex(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      expect(i, s).toBeLessThanOrEqual(WELCOME_STEPS.length);
    }
  });

  it("never moves backwards along the happy path", () => {
    const path: OnboardingStatus[] = [
      "AWAITING_KYC_PAYMENT",
      "UNDER_REVIEW",
      "READY_FOR_SIGNATURE",
      "FRANCHISE_SIGNED",
      "LOI_COMPLETE",
    ];
    const idx = path.map(currentWelcomeStepIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("corrections put the franchisee back on the documents step with the documents button", () => {
    expect(currentWelcomeStepIndex("CORRECTIONS_REQUESTED")).toBe(0);
    expect(welcomeAction("CORRECTIONS_REQUESTED").href).toBe("/onboarding/documents");
  });

  it("only points at portal routes that exist", () => {
    const allowed = new Set(["/onboarding", "/onboarding/documents", "/onboarding/loi"]);
    for (const s of ALL) expect(allowed.has(welcomeAction(s).href), s).toBe(true);
  });
});
