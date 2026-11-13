import type { Role } from "@prisma/client";

/**
 * Role -> module access, in one place (plan.md section 12). Pure and
 * client-safe on purpose (no `server-only`, no DB): `permissions.ts` builds its
 * per-action checks on these sets and the sidebar uses `canSeeModule`, so the
 * menu and the server can't drift apart.
 *
 * Dashboard task assignments are NOT here — they are per-user data, not a
 * property of the role (see dashboard-access.ts).
 */

export type AppModule = "dashboard" | "site-tracker" | "site-boq" | "operations-boq";

/** The one external role. Dashboard shows them only their own assigned site; no other module. */
export const EXTERNAL_ROLES: readonly Role[] = ["FRANCHISEE"];

/** Site BOQ + Operations BOQ pages: procurement, site execution and money roles. */
export const BOQ_VIEW_ROLES: readonly Role[] = [
  "ADMIN",
  "OPERATIONS",
  "PROJECT_MANAGER",
  "INTERIORS",
  "ACCOUNTS",
  "MANAGEMENT",
];

/** Edit qty / remark-size / order-tracking fields in Site BOQ. Accounts and Management are view-only here. */
export const BOQ_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"];

/** Create / download purchase orders: the BOQ editors plus Accounts. */
export const PO_ROLES: readonly Role[] = [...BOQ_EDIT_ROLES, "ACCOUNTS"];

/** Operations BOQ cell/row edits (unchanged from before this section). */
export const OPS_BOQ_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS"];

/** Site Tracker status/assignee/remark/evidence-add. Everyone else internal is view-only. */
export const TRACKER_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"];

export function isExternalRole(role: Role): boolean {
  return EXTERNAL_ROLES.includes(role);
}

export function canSeeModule(role: Role, module: AppModule): boolean {
  switch (module) {
    case "dashboard":
      return true;
    case "site-tracker":
      return !isExternalRole(role);
    case "site-boq":
    case "operations-boq":
      return BOQ_VIEW_ROLES.includes(role);
  }
}

/** Where a user lands after login / password set / visiting `/`. Roles that can't see Site BOQ would 403 there. */
export function landingPathForRole(role: Role): string {
  return canSeeModule(role, "site-boq") ? "/site-boq" : "/dashboard";
}
