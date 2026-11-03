import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { failBodySchema } from "@/lib/sheet-sync/schema";
import { failRun } from "@/lib/sheet-sync/run";

export async function POST(request: NextRequest) {
  return withSheetSyncSecret(request, async (body) => {
    const parsed = failBodySchema.parse(body);
    await failRun(parsed);
    return NextResponse.json({ ok: true });
  });
}
