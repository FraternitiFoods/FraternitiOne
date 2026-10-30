import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withImportGuard } from "@/lib/import/route-guard";
import { photoBodySchema } from "@/lib/import/schema";
import { uploadImportPhoto } from "@/lib/import/boq-import";

export async function POST(request: NextRequest) {
  return withImportGuard(request, async (body) => {
    const parsed = photoBodySchema.parse(body);
    const { storageKey } = await uploadImportPhoto(parsed.runId, parsed);
    return NextResponse.json({ ok: true, storageKey });
  });
}
