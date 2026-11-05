import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { checkPending } from "@/lib/dashboard-sync/run";

/** GET /api/dashboard-sync/pending — polled every minute by the Apps Script. */
export async function GET(request: NextRequest) {
  return withDashboardSyncSecret(request, async () => {
    const result = await checkPending();
    return NextResponse.json(result);
  });
}
