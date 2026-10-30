import "server-only";

import type { CurrentUser } from "@/lib/session";

/**
 * RBAC for this branch's baseline (auth/users/roles only — see plan.md
 * milestone M0). Site BOQ's own role matrix (plan.md section 5: Admin / other
 * internal roles / external roles) lands in milestone M5 alongside edit mode;
 * nothing before that needs a permission check beyond user management.
 */

/**
 * Creating/listing user accounts is scoped to ADMIN only.
 */
export function canManageUsers(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Site BOQ is internal-only (plan.md section 2): every /site-boq/* page must
 * 403 a FRANCHISEE user. All other internal roles can view every screen
 * (plan.md section 5, "View all Site BOQ screens: yes") until M5's edit-mode
 * role matrix adds finer-grained write checks.
 */
export function canViewSiteBoq(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}
