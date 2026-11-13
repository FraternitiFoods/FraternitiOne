import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  canViewSiteBoq,
  canEditSiteItemTracking,
  canEditItems,
  canEditVendors,
  canEditSites,
  canEditSettings,
  canFlipMode,
  canViewAuditLog,
  canCreatePo,
  canCreateDashboardSite,
  canEditDashboardSite,
  canDeleteDashboardSite,
  canAssignDashboardTasks,
  canViewSiteTracker,
  canEditSiteTracker,
  canViewOpsBoq,
  canEditOpsBoq,
  canManageUsers,
} from "./permissions";

/** Every value of the Role enum — a new role must be added here and decided in plan.md section 12. */
const ALL_ROLES: Role[] = [
  "FRANCHISEE",
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
  "ADMIN",
];

function user(role: Role) {
  return { role };
}

/** Asserts `check` is true for exactly `allowed` and false for every other role. */
function expectOnly(check: (u: { role: Role }) => boolean, allowed: Role[]) {
  for (const role of ALL_ROLES) {
    expect(check(user(role)), `${check.name} for ${role}`).toBe(allowed.includes(role));
  }
}

/** plan.md section 12's role matrix, verified function-by-function against every role. */
describe("permissions — plan.md section 12 role matrix", () => {
  it("View Site BOQ + Operations BOQ: Admin, Operations, Project Manager, Interiors, Accounts, Management", () => {
    const viewers: Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS", "ACCOUNTS", "MANAGEMENT"];
    expectOnly(canViewSiteBoq, viewers);
    expectOnly(canViewOpsBoq, viewers);
  });

  it("Edit qty/remark/order-tracking: Admin, Operations, Project Manager, Interiors (not Accounts/Management)", () => {
    expectOnly(canEditSiteItemTracking, ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"]);
  });

  it("Create/download POs: the BOQ editors plus Accounts (Management is view-only)", () => {
    expectOnly(canCreatePo, ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS", "ACCOUNTS"]);
  });

  it("Operations BOQ edits: Admin + Operations only", () => {
    expectOnly(canEditOpsBoq, ["ADMIN", "OPERATIONS"]);
  });

  it("Site Tracker: every internal role views, only Admin/Operations/Project Manager/Interiors edit, FRANCHISEE nothing", () => {
    expectOnly(canViewSiteTracker, ALL_ROLES.filter((r) => r !== "FRANCHISEE"));
    expectOnly(canEditSiteTracker, ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"]);
  });

  it("Admin-only: items/vendor rates, vendors, sites, settings, mode, audit log, users, Dashboard site CRUD, task assignment", () => {
    for (const check of [
      canEditItems,
      canEditVendors,
      canEditSites,
      canEditSettings,
      canFlipMode,
      canViewAuditLog,
      canManageUsers,
      canCreateDashboardSite,
      canEditDashboardSite,
      canDeleteDashboardSite,
      canAssignDashboardTasks,
    ]) {
      expectOnly(check, ["ADMIN"]);
    }
  });
});
