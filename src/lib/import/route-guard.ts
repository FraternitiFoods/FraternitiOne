import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { hasValidImportSecret } from "./auth";
import { getImportMode } from "@/lib/app-settings";
import { ImportError } from "./errors";

/**
 * Shared guard for every /api/import/boq/* route (plan.md section 7): bearer
 * secret (401), mode gating (403), then the route's own handler. Checked in
 * this order — not the order section 7's prose happens to list them in — so
 * an unauthenticated caller never learns the current mode.
 */
export async function withImportGuard(
  request: NextRequest,
  handler: (body: unknown) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasValidImportSecret(request)) {
    return NextResponse.json({ error: "Invalid or missing bearer secret." }, { status: 401 });
  }

  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") {
    return NextResponse.json({ error: "Import is disabled: mode is WEBSITE_LIVE." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    return await handler(body);
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request body.", issues: err.issues }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Conflict: a unique value collided with an existing row.", meta: err.meta },
        { status: 409 }
      );
    }
    console.error("Import API error:", err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
