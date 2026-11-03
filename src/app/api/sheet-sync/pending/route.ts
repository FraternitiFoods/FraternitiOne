import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { checkPending } from "@/lib/sheet-sync/run";

/** GET /api/sheet-sync/pending — polled every minute by the Apps Script. */
export async function GET(request: NextRequest) {
  return withSheetSyncSecret(request, async () => {
    const result = await checkPending();
    return NextResponse.json(result);
  });
}
