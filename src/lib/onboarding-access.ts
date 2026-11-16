import "server-only";

import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewOnboardingModule } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";

/**
 * Call at the top of every staff Store Onboarding page (`/store-onboarding/*`,
 * `/signing/*`) — the 403 gate in one place, same shape as requireSiteBoqUser()
 * / requireOpsBoqUser(). Franchisees never reach these pages (they use the
 * /onboarding portal) and roles outside ONBOARDING_VIEW_ROLES get the segment's
 * forbidden.tsx. Per-action checks (canReviewKyc, canPrepareLoi, ...) still
 * run inside each page/action on top of this.
 */
export async function requireOnboardingUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewOnboardingModule(user)) {
    forbidden();
  }
  return user;
}
