import { describe, it, expect } from "vitest";
import { trackerProgressPercent, canMarkCompleted, canDeleteEvidence } from "./tracker-calc";

describe("trackerProgressPercent — site-tracker-plan.md section 9 acceptance numbers", () => {
  it("Pavitra: 66 completed, 41 not required of 177 -> 66/136 = 48.5%", () => {
    const percent = trackerProgressPercent({ completed: 66, notRequired: 41, totalSteps: 177 });
    expect(percent).toBeCloseTo(48.5, 1);
  });

  it("Indore: 103 completed, 0 not required of 177 -> 103/177 = 58.2%", () => {
    const percent = trackerProgressPercent({ completed: 103, notRequired: 0, totalSteps: 177 });
    expect(percent).toBeCloseTo(58.2, 1);
  });

  it("Bangalore: 177 completed, 0 not required of 177 -> 100%", () => {
    const percent = trackerProgressPercent({ completed: 177, notRequired: 0, totalSteps: 177 });
    expect(percent).toBe(100);
  });

  it("is 0, not NaN or negative, when every step is Not required (denominator 0)", () => {
    const percent = trackerProgressPercent({ completed: 0, notRequired: 177, totalSteps: 177 });
    expect(percent).toBe(0);
  });

  it("is 0 when there are no steps at all", () => {
    const percent = trackerProgressPercent({ completed: 0, notRequired: 0, totalSteps: 0 });
    expect(percent).toBe(0);
  });
});

describe("canMarkCompleted (site-tracker-plan.md section 4 rule 1)", () => {
  it("rejects Completed with no evidence and no legacy flag", () => {
    expect(canMarkCompleted({ evidenceCount: 0, legacyCompleted: false })).toBe(false);
  });
  it("allows Completed with at least one evidence", () => {
    expect(canMarkCompleted({ evidenceCount: 1, legacyCompleted: false })).toBe(true);
  });
  it("allows Completed with no evidence when legacyCompleted", () => {
    expect(canMarkCompleted({ evidenceCount: 0, legacyCompleted: true })).toBe(true);
  });
});

describe("canDeleteEvidence (site-tracker-plan.md section 4 rule 3)", () => {
  it("blocks deleting the last evidence of a Completed, non-legacy step", () => {
    expect(canDeleteEvidence({ status: "COMPLETED", legacyCompleted: false, evidenceCount: 1 })).toBe(false);
  });
  it("allows deleting one of several evidence on a Completed step", () => {
    expect(canDeleteEvidence({ status: "COMPLETED", legacyCompleted: false, evidenceCount: 2 })).toBe(true);
  });
  it("allows deleting the last evidence of a legacyCompleted step", () => {
    expect(canDeleteEvidence({ status: "COMPLETED", legacyCompleted: true, evidenceCount: 1 })).toBe(true);
  });
  it("allows deleting the last evidence when the step isn't Completed", () => {
    expect(canDeleteEvidence({ status: "IN_PROGRESS", legacyCompleted: false, evidenceCount: 1 })).toBe(true);
  });
});
