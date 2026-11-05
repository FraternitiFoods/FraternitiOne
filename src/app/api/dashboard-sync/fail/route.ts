import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { failBodySchema } from "@/lib/dashboard-sync/schema";
import { failRun } from "@/lib/dashboard-sync/run";

export async function POST(request: NextRequest) {
  return withDashboardSyncSecret(request, async (body) => {
    const parsed = failBodySchema.parse(body);
    await failRun(parsed);
    return NextResponse.json({ ok: true });
  });
}
