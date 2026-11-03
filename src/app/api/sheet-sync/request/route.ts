import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerSheetSync } from "@/lib/permissions";
import { runSheetSyncHandler } from "@/lib/sheet-sync/guard";
import { requestSync } from "@/lib/sheet-sync/run";

/**
 * POST /api/sheet-sync/request — the "Sync with sheet" button. Admin
 * session auth, not the bearer secret (handoff section 3). requireUser()
 * is called unwrapped, outside runSheetSyncHandler's try/catch — it
 * redirects (not throws a normal error) when there's no session, via
 * Next.js's internal NEXT_REDIRECT mechanism, which must propagate up to
 * the framework untouched (src/app/api/tracker/sites/route.ts's GET is the
 * established pattern for this in the codebase).
 */
export async function POST() {
  const user = await requireUser();
  if (!canTriggerSheetSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }

  return runSheetSyncHandler(async () => {
    const { requestId } = await requestSync();
    return NextResponse.json({ requestId }, { status: 202 });
  });
}
