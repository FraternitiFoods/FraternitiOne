import { describe, expect, it } from "vitest";
import rawTemplate from "../../prisma/seed-data/dashboard-steps.json";
import { buildTemplate, validateTemplate, type RawTemplate, type TemplateStep } from "./dashboard-template";

const step = (over: Partial<TemplateStep>): TemplateStep => ({
  stageNo: 1,
  stageName: "Stage One",
  stepKey: "2",
  parentKey: null,
  label: "Step",
  sortOrder: 1,
  isParent: false,
  ...over,
});

describe("buildTemplate", () => {
  it("splits 'N - Name', numbers tasks per stage from 1", () => {
    expect(
      buildTemplate({
        stages: [
          { stage: "1 - Sales & Franchise", tasks: ["Lead", " Call "] },
          { stage: "12 - Grand Launch", tasks: ["Launch"] },
        ],
      })
    ).toEqual([
      { stageNo: 1, stageName: "Sales & Franchise", stepKey: "1", parentKey: null, label: "Lead", sortOrder: 1, isParent: false },
      { stageNo: 1, stageName: "Sales & Franchise", stepKey: "2", parentKey: null, label: "Call", sortOrder: 2, isParent: false },
      { stageNo: 12, stageName: "Grand Launch", stepKey: "1", parentKey: null, label: "Launch", sortOrder: 1, isParent: false },
    ]);
  });

  it("rejects a stage name without a number prefix", () => {
    expect(() => buildTemplate({ stages: [{ stage: "Sales", tasks: ["x"] }] })).toThrow(/must look like/);
  });
});

describe("validateTemplate", () => {
  it("counts leaves, parents and stages", () => {
    const summary = validateTemplate([
      step({ stepKey: "2", isParent: true }),
      step({ stepKey: "3", parentKey: "2" }),
      step({ stageNo: 2, stepKey: "2" }),
    ]);
    expect(summary).toEqual({ leaves: 2, parents: 1, stages: 2 });
  });

  it("rejects an empty template, empty labels, duplicates and dangling parents", () => {
    expect(() => validateTemplate([])).toThrow(/empty/);
    expect(() => validateTemplate([step({ label: "" })])).toThrow(/empty task/);
    expect(() => validateTemplate([step({}), step({})])).toThrow(/duplicate/);
    expect(() => validateTemplate([step({ parentKey: "99" })])).toThrow(/missing parent/);
  });

  it("allows the same stepKey in different stages", () => {
    expect(() => validateTemplate([step({ stageNo: 1 }), step({ stageNo: 2 })])).not.toThrow();
  });
});

describe("committed dashboard-steps.json", () => {
  it("is valid and has the documented 402 tasks over 13 stages", () => {
    const summary = validateTemplate(buildTemplate(rawTemplate as RawTemplate));
    expect(summary).toEqual({ leaves: 402, parents: 0, stages: 13 });
  });
});
