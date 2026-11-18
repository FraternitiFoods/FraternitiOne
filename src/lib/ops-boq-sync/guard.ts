import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { hasValidOpsBoqSyncSecret } from "./auth";
import { OpsBoqSyncError } from "./errors";

/** Same shape as dashboard-sync/guard.ts: bearer secret (401), JSON body (400), then the handler with the usual error mapping. */
export async function withOpsBoqSyncSecret(
  request: NextRequest,
  handler: (body: unknown) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasValidOpsBoqSyncSecret(request)) {
    return NextResponse.json({ error: "Invalid or missing bearer secret." }, { status: 401 });
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
    if (err instanceof OpsBoqSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request body.", issues: err.issues }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Conflict: a unique value collided with an existing row.", meta: err.meta }, { status: 409 });
    }
    console.error("Ops BOQ sync API error:", err);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
