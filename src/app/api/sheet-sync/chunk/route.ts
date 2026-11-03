import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { chunkBodySchema } from "@/lib/sheet-sync/schema";
import { storeChunk } from "@/lib/sheet-sync/run";

export async function POST(request: NextRequest) {
  return withSheetSyncSecret(request, async (body) => {
    const parsed = chunkBodySchema.parse(body);
    const result = await storeChunk(parsed);
    return NextResponse.json({ ok: true, warnings: result.warnings });
  });
}
