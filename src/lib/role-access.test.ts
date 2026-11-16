import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canSeeModule, landingPathForRole, type AppModule } from "./role-access";

const NO_BOQ_ROLES: Role[] = ["SALES", "LEGAL", "HR", "CULINARY", "MARKETING"];
const ONBOARDING_ROLES: Role[] = ["ADMIN", "SALES", "LEGAL", "ACCOUNTS", "MANAGEMENT"];
const BOQ_ROLES: Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS", "ACCOUNTS", "MANAGEMENT"];

function visibleModules(role: Role): AppModule[] {
  const all: AppModule[] = ["dashboard", "site-tracker", "site-boq", "operations-boq", "store-onboarding"];
  return all.filter((m) => canSeeModule(role, m));
}

describe("role-access — sidebar modules per role (plan.md section 12)", () => {
  it("Marketing/HR/Culinary see Dashboard + Site Tracker only", () => {
    for (const role of ["HR", "CULINARY", "MARKETING"] as Role[]) {
      expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker"]);
    }
  });

  it("Sales/Legal see Dashboard + Site Tracker + Store Onboarding (no BOQ)", () => {
    for (const role of ["SALES", "LEGAL"] as Role[]) {
      expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker", "store-onboarding"]);
    }
  });

  it("Operations, PM, Interiors see the four original modules (no onboarding)", () => {
    for (const role of ["OPERATIONS", "PROJECT_MANAGER", "INTERIORS"] as Role[]) {
      expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker", "site-boq", "operations-boq"]);
    }
  });

  it("Admin, Accounts, Management see all five modules", () => {
    for (const role of ["ADMIN", "ACCOUNTS", "MANAGEMENT"] as Role[]) {
      expect(visibleModules(role), role).toEqual(["dashboard", "site-tracker", "site-boq", "operations-boq", "store-onboarding"]);
    }
    expect(ONBOARDING_ROLES.every((r) => canSeeModule(r, "store-onboarding"))).toBe(true);
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

  it("a franchisee mid-onboarding lands on the portal's Welcome page", () => {
    for (const status of [
      "AWAITING_KYC_PAYMENT",
      "UNDER_REVIEW",
      "CORRECTIONS_REQUESTED",
      "READY_FOR_SIGNATURE",
      "FRANCHISE_SIGNED",
    ] as const) {
      expect(landingPathForRole("FRANCHISEE", status), status).toBe("/onboarding/welcome");
    }
  });

  it("a converted franchisee (LOI Complete) goes to the Dashboard, not the portal", () => {
    expect(landingPathForRole("FRANCHISEE", "LOI_COMPLETE")).toBe("/dashboard");
  });
});
