import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withSheetSyncSecret } from "@/lib/sheet-sync/guard";
import { finishBodySchema } from "@/lib/sheet-sync/schema";
import { finishRun } from "@/lib/sheet-sync/run";

export const runtime = "nodejs";
// User's condition 3: finish does the heavy (batched/bulk) commit work for
// up to 680 items / ~3000 site entries in one DB transaction — give it real
// headroom instead of the platform default. Actual ceiling still depends on
// the Vercel plan tier (Hobby caps lower); flagged for the human to confirm
// at deploy time, same as every other plan.md "needs a human" item.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return withSheetSyncSecret(request, async (body) => {
    const parsed = finishBodySchema.parse(body);
    const result = await finishRun(parsed);
    return NextResponse.json(result);
  });
}
