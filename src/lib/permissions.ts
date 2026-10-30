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
