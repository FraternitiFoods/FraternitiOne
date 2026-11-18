import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withOpsBoqSyncSecret } from "@/lib/ops-boq-sync/guard";
import { failBodySchema } from "@/lib/ops-boq-sync/schema";
import { failOpsBoq } from "@/lib/ops-boq-sync/commit";

export async function POST(request: NextRequest) {
  return withOpsBoqSyncSecret(request, async (body) => {
    await failOpsBoq(failBodySchema.parse(body));
    return NextResponse.json({ ok: true });
  });
}
