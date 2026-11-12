import "server-only";

import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewOpsBoq } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";

/**
 * Call at the top of every `/operations-boq` Server Component page — the
 * internal-only 403 gate (operations-boq-handoff.md section 7) in one place,
 * same shape as requireSiteBoqUser().
 */
export async function requireOpsBoqUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewOpsBoq(user)) {
    forbidden();
  }
  return user;
}
