import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerSheetSync } from "@/lib/permissions";

/**
 * POST /api/sheet-sync/request — retired. The website is the source of truth,
 * so the "Sync with sheet" button is gone and no new request may be queued
 * (a stale tab must not re-stick the sheetSyncRequest state). The Apps
 * Script-facing endpoints (pending/start/chunk/finish/fail/status) are left in
 * place. requireUser() stays unwrapped so its redirect propagates.
 */
export async function POST() {
  const user = await requireUser();
  if (!canTriggerSheetSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }
  return NextResponse.json({ error: "Sheet sync is retired; the website is the source of truth." }, { status: 410 });
}
