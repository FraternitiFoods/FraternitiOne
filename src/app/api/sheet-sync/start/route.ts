import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { startBodySchema } from "@/lib/sheet-sync/schema";
import { startRun } from "@/lib/sheet-sync/run";

export async function POST(request: NextRequest) {
  return withSheetSyncSecret(request, async (body) => {
    const parsed = startBodySchema.parse(body);
    const { runId, changed } = await startRun(parsed);
    // `changed` only when the script sent a tabManifest (unified sync): the
    // categories whose content differs and so must be chunked.
    return NextResponse.json(changed ? { runId, changed } : { runId });
  });
}
