import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withImportGuard } from "@/lib/import/route-guard";
import { beginBodySchema } from "@/lib/import/schema";
import { createImportRun } from "@/lib/import/boq-import";

export async function POST(request: NextRequest) {
  return withImportGuard(request, async (body) => {
    const { dryRun } = beginBodySchema.parse(body);
    const run = await createImportRun(dryRun);
    return NextResponse.json({ runId: run.id });
  });
}
