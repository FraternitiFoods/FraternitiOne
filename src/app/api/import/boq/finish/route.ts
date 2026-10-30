import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withImportGuard } from "@/lib/import/route-guard";
import { finishBodySchema } from "@/lib/import/schema";
import { finishImportRun } from "@/lib/import/boq-import";

export async function POST(request: NextRequest) {
  return withImportGuard(request, async (body) => {
    const { runId } = finishBodySchema.parse(body);
    const { run, deactivatedSites, deactivatedItems } = await finishImportRun(runId);

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      dryRun: run.dryRun,
      counts: run.counts,
      warnings: run.warnings,
      deactivated: { sites: deactivatedSites, items: deactivatedItems },
    });
  });
}
