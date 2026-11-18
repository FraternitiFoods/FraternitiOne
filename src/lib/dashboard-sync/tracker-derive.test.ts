import { describe, expect, it } from "vitest";
import { deriveTrackerRows, trackerCodeForLabel } from "./tracker-derive";
import type { StepInput } from "./schema";

const step = (over: Partial<StepInput> & { label: string }): StepInput => ({
  stepKey: over.label,
  sortOrder: 0,
  isParent: false,
  shared: false,
  deliverables: [],
  assignedTo: null,
  remark: null,
  status: "Not started",
  ...over,
});

const site = (stage7: StepInput[], otherStage: StepInput[] = []) => ({
  stages: [
    { stageNo: 6, stageName: "Stage 6", steps: otherStage },
    { stageNo: 7, stageName: "Stage 7 - Construction Execution", steps: stage7 },
  ],
});

describe("trackerCodeForLabel", () => {
  it("reads the leading code", () => {
    expect(trackerCodeForLabel("7.1.2 Site condition inspection")).toBe("7.1.2");
    expect(trackerCodeForLabel("  7.18.10  Handover")).toBe("7.18.10");
  });
  it("does not accept a longer dotted number or another stage's code", () => {
    expect(trackerCodeForLabel("7.1.2.3 Odd")).toBeNull();
    expect(trackerCodeForLabel("6.1.2 Not stage 7")).toBeNull();
    expect(trackerCodeForLabel("Site condition inspection")).toBeNull();
  });
  it("maps the synthetic Deep Cleaning leaf (no code in the sheet) to 7.18.1", () => {
    expect(trackerCodeForLabel("Deep Cleaning")).toBe("7.18.1");
    expect(trackerCodeForLabel("  deep   cleaning ")).toBe("7.18.1");
  });
});

describe("deriveTrackerRows", () => {
  it("uses only Stage 7 leaves; skips parents and unmatched labels", () => {
    const rows = deriveTrackerRows(
      site(
        [
          step({ label: "7.1 Section", isParent: true, status: null }),
          step({ label: "7.1.1 Hoarding", status: "Completed", assignedTo: " Ravi ", remark: " done " }),
          step({ label: "Some unrelated leaf" }),
        ],
        [step({ label: "6.1.1 Other stage", status: "Completed" })]
      )
    );
    expect(rows).toEqual([{ code: "7.1.1", status: "COMPLETED", assignee: "Ravi", remark: "done" }]);
  });

  it("maps all four sheet statuses and treats a missing status as Not started", () => {
    const rows = deriveTrackerRows(
      site([
        step({ label: "7.1.1 a", status: "Not started" }),
        step({ label: "7.1.2 b", status: "In progress" }),
        step({ label: "7.1.3 c", status: "Completed" }),
        step({ label: "7.1.4 d", status: "Not required" }),
        step({ label: "7.1.5 e", status: null }),
      ])
    );
    expect(rows.map((r) => r.status)).toEqual(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED", "NOT_STARTED"]);
  });

  it("the first occurrence of a code wins", () => {
    const rows = deriveTrackerRows(site([step({ label: "7.1.1 a", status: "Completed" }), step({ label: "7.1.1 dup", status: "In progress" })]));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMPLETED");
  });

  it("a site without a Stage 7 yields nothing", () => {
    expect(deriveTrackerRows({ stages: [] })).toEqual([]);
  });
});
