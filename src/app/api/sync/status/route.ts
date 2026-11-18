import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canTriggerUnifiedSync } from "@/lib/permissions";
import { getSyncStatus } from "@/lib/sync-batch/view";

/**
 * GET /api/sync/status — polled by the unified Sync button, and only while a
 * batch is active. Pure read: unlike the retired per-sheet getStatus() it never
 * reaps runs or sends alert emails (see src/lib/sync-batch/view.ts).
 */
export async function GET() {
  const user = await requireUser();
  if (!canTriggerUnifiedSync(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }
  const status = await getSyncStatus(db);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
