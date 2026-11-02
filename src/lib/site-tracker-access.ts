import "server-only";

import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewSiteTracker } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";

/**
 * Call at the top of the `/site-tracker` Server Component page — enforces
 * the internal-only 403 gate (site-tracker-plan.md section 4, rule 6).
 * `forbidden()` renders the nearest `forbidden.tsx` boundary, which only
 * exists for page renders — `/api/tracker/*` Route Handlers check
 * `canViewSiteTracker`/`canEditSiteTracker` directly and return a plain
 * `NextResponse.json(..., { status: 403 })` instead (see pdf route.ts for
 * the same pattern on the Site BOQ side).
 */
export async function requireSiteTrackerUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewSiteTracker(user)) {
    forbidden();
  }
  return user;
}
