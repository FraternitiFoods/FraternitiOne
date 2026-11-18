import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { startBodySchema } from "@/lib/dashboard-sync/schema";
import { startRun } from "@/lib/dashboard-sync/run";

export async function POST(request: NextRequest) {
  return withDashboardSyncSecret(request, async (body) => {
    const parsed = startBodySchema.parse(body);
    const { runId, changed } = await startRun(parsed);
    // `changed` only when the script sent a manifest (unified sync): the sites
    // whose content differs and so must be chunked. Old-style runs get just runId.
    return NextResponse.json(changed ? { runId, changed } : { runId });
  });
}
