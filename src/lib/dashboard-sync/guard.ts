import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { hasValidDashboardSyncSecret } from "./auth";
import { DashboardSyncError } from "./errors";

/**
 * Mirrors src/lib/sheet-sync/guard.ts: bearer secret (401) then the route's
 * own handler, with the same error-mapping conventions. Unlike Site BOQ,
 * there is no mode to gate on — Dashboard is permanently read-only, so every
 * route here behaves the same regardless of any app setting.
 */
export async function withDashboardSyncSecret(
  request: NextRequest,
  handler: (body: unknown) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasValidDashboardSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid or missing bearer secret." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = request.method === "GET" ? {} : await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  return runDashboardSyncHandler(() => handler(body));
}

/** Same error-mapping as withDashboardSyncSecret's try/catch, reused by /api/dashboard-sync/request and /status (admin session, no bearer secret). */
export async function runDashboardSyncHandler(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof DashboardSyncError) {
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
    console.error("Dashboard sync API error:", err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
