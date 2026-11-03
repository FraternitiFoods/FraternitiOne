import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerSheetSync } from "@/lib/permissions";
import { runSheetSyncHandler } from "@/lib/sheet-sync/guard";
import { getStatus } from "@/lib/sheet-sync/run";

/**
 * GET /api/sheet-sync/status — polled by the Site BOQ page while a
 * request/run is active. Handoff section 6: "Button + status UI ... admin
 * only" — same gate as /request. requireUser() is called unwrapped, see
 * /api/sheet-sync/request/route.ts's comment for why.
 */
export async function GET() {
  const user = await requireUser();
  if (!canTriggerSheetSync(user)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return runSheetSyncHandler(async () => {
    const status = await getStatus();
    return NextResponse.json(status);
  });
}
