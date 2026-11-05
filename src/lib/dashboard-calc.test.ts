import { describe, it, expect } from "vitest";
import { computeSiteStats, deriveParentStatus, type LeafStepLike } from "./dashboard-calc";

describe("deriveParentStatus (dashboard-sheet-sync-plan.md section 3)", () => {
  it("is NOT_REQUIRED when every child is Not required", () => {
    expect(deriveParentStatus(["NOT_REQUIRED", "NOT_REQUIRED"])).toBe("NOT_REQUIRED");
  });

  it("is COMPLETED when every non-Not-required child is Completed", () => {
    expect(deriveParentStatus(["COMPLETED", "COMPLETED", "NOT_REQUIRED"])).toBe("COMPLETED");
  });

  it("is IN_PROGRESS when some children are Completed/In progress but not all", () => {
    expect(deriveParentStatus(["COMPLETED", "NOT_STARTED"])).toBe("IN_PROGRESS");
    expect(deriveParentStatus(["IN_PROGRESS", "NOT_STARTED"])).toBe("IN_PROGRESS");
  });

  it("is NOT_STARTED when no relevant child has started", () => {
    expect(deriveParentStatus(["NOT_STARTED", "NOT_STARTED"])).toBe("NOT_STARTED");
  });
});

describe("computeSiteStats (dashboard-sheet-sync-plan.md section 5 percentage rules)", () => {
  it("matches the hand-computed numbers in scripts/fixtures/dashboard-sync-fixture.json for Fixture Site A", () => {
    const steps: LeafStepLike[] = [
      { stageNo: 1, isParent: false, status: "COMPLETED", shared: false },
      { stageNo: 1, isParent: false, status: "IN_PROGRESS", shared: true },
      { stageNo: 1, isParent: false, status: "NOT_REQUIRED", shared: false },
      { stageNo: 2, isParent: false, status: "COMPLETED", shared: false },
      { stageNo: 2, isParent: true, status: null, shared: false },
      { stageNo: 2, isParent: false, status: "COMPLETED", shared: false },
      { stageNo: 2, isParent: false, status: "IN_PROGRESS", shared: false },
      { stageNo: 5, isParent: false, status: null, shared: false },
    ];

    const stats = computeSiteStats(steps);

    expect(stats.total).toBe(6); // 7 leaves (parent excluded) - 1 not-required
    expect(stats.completed).toBe(3);
    expect(stats.inProgress).toBe(2);
    expect(stats.notStarted).toBe(1); // stage 5's blank status
    expect(stats.notRequired).toBe(1);
    expect(stats.shared).toBe(1);
    expect(stats.notShared).toBe(5);
    expect(stats.pct).toBeCloseTo(0.5);

    const stage1 = stats.perStage.find((s) => s.stageNo === 1)!;
    expect(stage1.pct).toBeCloseTo(0.5); // 1 completed / (3 leaves - 1 not required)
    const stage2 = stats.perStage.find((s) => s.stageNo === 2)!;
    expect(stage2.pct).toBeCloseTo(2 / 3); // parent excluded from the 3 leaves
    const stage5 = stats.perStage.find((s) => s.stageNo === 5)!;
    expect(stage5.pct).toBe(0);
  });

  it("a blank status on a leaf counts as Not started", () => {
    const stats = computeSiteStats([{ stageNo: 1, isParent: false, status: null, shared: false }]);
    expect(stats.notStarted).toBe(1);
    expect(stats.completed).toBe(0);
  });

  it("a stage where every leaf is Not required has 0 applicable and 0 pct, not divide-by-zero", () => {
    const stats = computeSiteStats([{ stageNo: 2, isParent: false, status: "NOT_REQUIRED", shared: false }]);
    const stage2 = stats.perStage.find((s) => s.stageNo === 2)!;
    expect(stage2.applicable).toBe(0);
    expect(stage2.pct).toBe(0);
  });
});
