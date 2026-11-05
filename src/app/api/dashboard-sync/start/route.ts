import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { startBodySchema } from "@/lib/dashboard-sync/schema";
import { startRun } from "@/lib/dashboard-sync/run";

export async function POST(request: NextRequest) {
  return withDashboardSyncSecret(request, async (body) => {
    const parsed = startBodySchema.parse(body);
    const { runId } = await startRun(parsed);
    return NextResponse.json({ runId });
  });
}
