import "server-only";

import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewSiteBoq } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";

/**
 * Call at the top of every `/site-boq/*` Server Component page — enforces
 * the internal-only 403 gate (plan.md section 2) in one place instead of
 * repeating the `requireUser()` + role check per page.
 */
export async function requireSiteBoqUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewSiteBoq(user)) {
    forbidden();
  }
  return user;
}
