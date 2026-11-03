import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { hasValidSheetSyncSecret } from "./auth";
import { SyncError } from "./errors";

/**
 * Shared guard for the script-only /api/sheet-sync/* routes: bearer secret
 * (401) then the route's own handler, with the same error-mapping
 * conventions as src/lib/import/route-guard.ts. Unlike that guard, mode
 * gating is NOT done here — each sheet-sync route reacts to mode
 * differently (user's decision, see sync-run.ts): /pending returns
 * {pending:false} instead of 403, /request rejects with a clear message,
 * /start and /chunk 403 like the old importer, and /finish re-checks mode
 * itself and fails the run rather than bouncing the HTTP call.
 */
export async function withSheetSyncSecret(
  request: NextRequest,
  handler: (body: unknown) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasValidSheetSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid or missing bearer secret." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = request.method === "GET" ? {} : await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  return runSheetSyncHandler(() => handler(body));
}

/** Same error-mapping as withSheetSyncSecret's try/catch, reused by /api/sheet-sync/request (admin session, no bearer secret). */
export async function runSheetSyncHandler(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof SyncError) {
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
    console.error("Sheet sync API error:", err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
