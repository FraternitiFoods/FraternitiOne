import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canEditStep, canOpenStage, openableStageNos } from "./dashboard-access";

const INTERNAL_NON_ADMIN: Role[] = [
  "SALES",
  "LEGAL",
  "INTERIORS",
  "PROJECT_MANAGER",
  "ACCOUNTS",
  "HR",
  "CULINARY",
  "MARKETING",
  "OPERATIONS",
  "MANAGEMENT",
];

const tonyStages = new Set([1, 8]);

describe("canOpenStage", () => {
  it("Admin opens every stage", () => {
    expect(canOpenStage({ role: "ADMIN", stageNo: 5, assignedStageNos: new Set() })).toBe(true);
  });

  it("a franchisee on their own site (caller already checked) opens every stage, read-only", () => {
    expect(canOpenStage({ role: "FRANCHISEE", stageNo: 5, assignedStageNos: new Set() })).toBe(true);
  });

  it("every other internal role opens a stage only if assigned >= 1 task in it", () => {
    for (const role of INTERNAL_NON_ADMIN) {
      expect(canOpenStage({ role, stageNo: 1, assignedStageNos: tonyStages }), role).toBe(true);
      expect(canOpenStage({ role, stageNo: 8, assignedStageNos: tonyStages }), role).toBe(true);
      expect(canOpenStage({ role, stageNo: 2, assignedStageNos: tonyStages }), role).toBe(false);
      expect(canOpenStage({ role, stageNo: 1, assignedStageNos: new Set() }), role).toBe(false);
    }
  });
});

describe("canEditStep", () => {
  const base = { origin: "WEBSITE" as const, isParent: false, isAssignedToStep: false };

  it("Admin edits any leaf step on a website site, assigned or not", () => {
    expect(canEditStep({ ...base, role: "ADMIN" })).toBe(true);
  });

  it("another internal role edits only steps assigned to them", () => {
    for (const role of INTERNAL_NON_ADMIN) {
      expect(canEditStep({ ...base, role, isAssignedToStep: true }), role).toBe(true);
      expect(canEditStep({ ...base, role, isAssignedToStep: false }), role).toBe(false);
    }
  });

  it("a franchisee never edits, even with a stray assignment row", () => {
    expect(canEditStep({ ...base, role: "FRANCHISEE", isAssignedToStep: true })).toBe(false);
  });

  it("nobody edits on a sheet-synced site (the next sync would overwrite it) — not even Admin", () => {
    for (const role of ["ADMIN", ...INTERNAL_NON_ADMIN] as Role[]) {
      expect(canEditStep({ ...base, role, origin: "SHEET", isAssignedToStep: true }), role).toBe(false);
    }
  });

  it("nobody edits a parent row (status is derived from children)", () => {
    for (const role of ["ADMIN", ...INTERNAL_NON_ADMIN] as Role[]) {
      expect(canEditStep({ ...base, role, isParent: true, isAssignedToStep: true }), role).toBe(false);
    }
  });
});

describe("openableStageNos", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  it("Tony (assigned 1 and 8) can tap only those two cards", () => {
    const open = openableStageNos({ role: "MARKETING", allStageNos: all, assignedStageNos: tonyStages });
    expect([...open].sort((a, b) => a - b)).toEqual([1, 8]);
  });

  it("an unassigned internal user can tap nothing; Admin taps everything", () => {
    expect(openableStageNos({ role: "SALES", allStageNos: all, assignedStageNos: new Set() }).size).toBe(0);
    expect(openableStageNos({ role: "ADMIN", allStageNos: all, assignedStageNos: new Set() }).size).toBe(13);
  });
});
