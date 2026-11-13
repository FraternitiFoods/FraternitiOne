import { describe, expect, it } from "vitest";
import {
  MAX_ASSIGNED_STEPS,
  countByStage,
  diffAssignments,
  setUserSiteAssignmentsSchema,
} from "./dashboard-assignment-input";

describe("setUserSiteAssignmentsSchema", () => {
  it("accepts a normal payload and de-duplicates step ids", () => {
    const parsed = setUserSiteAssignmentsSchema.parse({ siteId: "s", userId: "u", stepIds: ["a", "b", "a"] });
    expect(parsed.stepIds).toEqual(["a", "b"]);
  });

  it("accepts an empty list (that is how a person is removed from a site)", () => {
    expect(setUserSiteAssignmentsSchema.safeParse({ siteId: "s", userId: "u", stepIds: [] }).success).toBe(true);
  });

  it("rejects missing ids, non-string step ids and oversized payloads", () => {
    expect(setUserSiteAssignmentsSchema.safeParse({ siteId: "", userId: "u", stepIds: [] }).success).toBe(false);
    expect(setUserSiteAssignmentsSchema.safeParse({ siteId: "s", userId: "u", stepIds: [1] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_ASSIGNED_STEPS + 1 }, (_, i) => `id${i}`);
    expect(setUserSiteAssignmentsSchema.safeParse({ siteId: "s", userId: "u", stepIds: tooMany }).success).toBe(false);
  });
});

describe("diffAssignments", () => {
  it("returns only what has to change", () => {
    expect(diffAssignments(["a", "b", "c"], ["b", "c", "d"])).toEqual({ toAdd: ["d"], toRemove: ["a"] });
  });

  it("is a no-op when nothing changed, regardless of order", () => {
    expect(diffAssignments(["a", "b"], ["b", "a"])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("removing everyone's tasks = empty next list", () => {
    expect(diffAssignments(["a", "b"], [])).toEqual({ toAdd: [], toRemove: ["a", "b"] });
  });
});

describe("countByStage", () => {
  it("counts tasks per stage for the audit log", () => {
    expect(countByStage([{ stageNo: 1 }, { stageNo: 1 }, { stageNo: 8 }])).toEqual({ "1": 2, "8": 1 });
    expect(countByStage([])).toEqual({});
  });
});
