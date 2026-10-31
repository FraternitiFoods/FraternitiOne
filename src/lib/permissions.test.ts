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
} from "./permissions";

const INTERNAL_ROLES: Role[] = [
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

function user(role: Role) {
  return { role };
}

/** plan.md section 5's role matrix, verified function-by-function. */
describe("permissions — plan.md section 5 role matrix", () => {
  it("View all Site BOQ screens: everyone except FRANCHISEE", () => {
    expect(canViewSiteBoq(user("ADMIN"))).toBe(true);
    for (const role of INTERNAL_ROLES) expect(canViewSiteBoq(user(role))).toBe(true);
    expect(canViewSiteBoq(user("FRANCHISEE"))).toBe(false);
  });

  it("Edit qty/remark/order-tracking: Admin and every other internal role, not FRANCHISEE", () => {
    expect(canEditSiteItemTracking(user("ADMIN"))).toBe(true);
    for (const role of INTERNAL_ROLES) expect(canEditSiteItemTracking(user(role))).toBe(true);
    expect(canEditSiteItemTracking(user("FRANCHISEE"))).toBe(false);
  });

  it("Edit items/vendor rates/final vendor/add items: Admin only", () => {
    expect(canEditItems(user("ADMIN"))).toBe(true);
    for (const role of INTERNAL_ROLES) expect(canEditItems(user(role))).toBe(false);
    expect(canEditItems(user("FRANCHISEE"))).toBe(false);
  });

  it("Edit vendors/sites/settings/flip mode: Admin only", () => {
    for (const check of [canEditVendors, canEditSites, canEditSettings, canFlipMode]) {
      expect(check(user("ADMIN"))).toBe(true);
      for (const role of INTERNAL_ROLES) expect(check(user(role))).toBe(false);
      expect(check(user("FRANCHISEE"))).toBe(false);
    }
  });

  it("View the audit log: Admin only, same row as settings", () => {
    expect(canViewAuditLog(user("ADMIN"))).toBe(true);
    for (const role of INTERNAL_ROLES) expect(canViewAuditLog(user(role))).toBe(false);
    expect(canViewAuditLog(user("FRANCHISEE"))).toBe(false);
  });
});
