import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canSeeModule, landingPathForRole, type AppModule } from "./role-access";

const NO_BOQ_ROLES: Role[] = ["SALES", "LEGAL", "HR", "CULINARY", "MARKETING"];
const BOQ_ROLES: Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS", "ACCOUNTS", "MANAGEMENT"];

function visibleModules(role: Role): AppModule[] {
  const all: AppModule[] = ["dashboard", "site-tracker", "site-boq", "operations-boq"];
  return all.filter((m) => canSeeModule(role, m));
}

describe("role-access — sidebar modules per role (plan.md section 12)", () => {
  it("Marketing/Sales/Legal/HR/Culinary see Dashboard + Site Tracker only", () => {
    for (const role of NO_BOQ_ROLES) expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker"]);
  });

  it("Admin, Operations, PM, Interiors, Accounts, Management see all four modules", () => {
    for (const role of BOQ_ROLES) {
      expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker", "site-boq", "operations-boq"]);
    }
  });

  it("FRANCHISEE sees Dashboard only", () => {
    expect(visibleModules("FRANCHISEE")).toEqual(["dashboard"]);
  });
});

describe("role-access — landing page", () => {
  it("roles that can open Site BOQ land there (Admin keeps /site-boq, which ci-smoke asserts)", () => {
    for (const role of BOQ_ROLES) expect(landingPathForRole(role), role).toBe("/site-boq");
  });

  it("everyone else lands on the Dashboard instead of a 403", () => {
    for (const role of [...NO_BOQ_ROLES, "FRANCHISEE" as Role]) expect(landingPathForRole(role), role).toBe("/dashboard");
  });
});
