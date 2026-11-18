import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withOpsBoqSyncSecret } from "@/lib/ops-boq-sync/guard";
import { commitBodySchema } from "@/lib/ops-boq-sync/schema";
import { runOpsBoqCommit } from "@/lib/ops-boq-sync/commit";

export const runtime = "nodejs";
// The whole sheet commits in one transaction (a few hundred rows). 60s is
// generous headroom; the Vercel plan tier still decides the real ceiling.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return withOpsBoqSyncSecret(request, async (body) => {
    const parsed = commitBodySchema.parse(body);
    const result = await runOpsBoqCommit(parsed);
    return NextResponse.json({ ok: true, ...result });
  });
}
