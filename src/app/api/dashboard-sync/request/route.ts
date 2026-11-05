import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerDashboardSync } from "@/lib/permissions";
import { runDashboardSyncHandler } from "@/lib/dashboard-sync/guard";
import { requestSync } from "@/lib/dashboard-sync/run";

/**
 * POST /api/dashboard-sync/request — the "Sync with sheet" button. Internal
 * roles only (dashboard-sheet-sync-plan.md section 0/6), not Admin-only like
 * Site BOQ's equivalent. Session auth, not the bearer secret.
 * requireUser() is called unwrapped, outside runDashboardSyncHandler's
 * try/catch — same reason as /api/sheet-sync/request's.
 */
export async function POST() {
  const user = await requireUser();
  if (!canTriggerDashboardSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }

  return runDashboardSyncHandler(async () => {
    const { requestId } = await requestSync();
    return NextResponse.json({ requestId }, { status: 202 });
  });
}
