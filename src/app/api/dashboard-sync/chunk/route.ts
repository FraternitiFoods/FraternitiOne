import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withDashboardSyncSecret } from "@/lib/dashboard-sync/guard";
import { chunkBodySchema } from "@/lib/dashboard-sync/schema";
import { storeChunk } from "@/lib/dashboard-sync/run";

export async function POST(request: NextRequest) {
  return withDashboardSyncSecret(request, async (body) => {
    const parsed = chunkBodySchema.parse(body);
    const result = await storeChunk(parsed);
    return NextResponse.json({ ok: true, warnings: result.warnings });
  });
}
