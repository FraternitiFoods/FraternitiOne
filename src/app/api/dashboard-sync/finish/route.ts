import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { finishBodySchema } from "@/lib/dashboard-sync/schema";
import { finishRun } from "@/lib/dashboard-sync/run";

export const runtime = "nodejs";
// Same reasoning as /api/sheet-sync/finish: the commit transaction covers
// ~23 sites x ~400 steps in one go — give it real headroom instead of the
// platform default. Actual ceiling still depends on the Vercel plan tier.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return withDashboardSyncSecret(request, async (body) => {
    const parsed = finishBodySchema.parse(body);
    const result = await finishRun(parsed);
    return NextResponse.json(result);
  });
}
