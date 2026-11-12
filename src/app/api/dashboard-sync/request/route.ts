import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canTriggerDashboardSync } from "@/lib/permissions";

/**
 * POST /api/dashboard-sync/request — retired (see /api/sheet-sync/request).
 * The website is the source of truth; no new sync request may be queued.
 */
export async function POST() {
  const user = await requireUser();
  if (!canTriggerDashboardSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }
  return NextResponse.json({ error: "Sheet sync is retired; the website is the source of truth." }, { status: 410 });
}
