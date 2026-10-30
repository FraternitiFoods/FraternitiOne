import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withImportGuard } from "@/lib/import/route-guard";
import { chunkBodySchema } from "@/lib/import/schema";
import { runSitesChunk, runVendorsChunk, runCategoryChunk } from "@/lib/import/boq-import";

export async function POST(request: NextRequest) {
  return withImportGuard(request, async (body) => {
    const parsed = chunkBodySchema.parse(body);

    const result =
      parsed.type === "sites"
        ? await runSitesChunk(parsed.runId, parsed.data)
        : parsed.type === "vendors"
          ? await runVendorsChunk(parsed.runId, parsed.data)
          : await runCategoryChunk(parsed.runId, parsed.data);

    return NextResponse.json({ ok: true, warnings: result.warnings });
  });
}
