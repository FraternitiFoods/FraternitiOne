import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { startBodySchema } from "@/lib/sheet-sync/schema";
import { startRun } from "@/lib/sheet-sync/run";

export async function POST(request: NextRequest) {
  return withSheetSyncSecret(request, async (body) => {
    const parsed = startBodySchema.parse(body);
    const { runId } = await startRun(parsed);
    return NextResponse.json({ runId });
  });
}
