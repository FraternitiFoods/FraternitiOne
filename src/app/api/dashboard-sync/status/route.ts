import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerDashboardSync } from "@/lib/permissions";
import { runDashboardSyncHandler } from "@/lib/dashboard-sync/guard";
import { getStatus } from "@/lib/dashboard-sync/run";

/**
 * GET /api/dashboard-sync/status — polled by the Dashboard page while a
 * request/run is active. Same gate as /request: internal roles only.
 */
export async function GET() {
  const user = await requireUser();
  if (!canTriggerDashboardSync(user)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return runDashboardSyncHandler(async () => {
    const status = await getStatus();
    return NextResponse.json(status);
  });
}
