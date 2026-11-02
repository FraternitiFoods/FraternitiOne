import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Unauthenticated liveness/readiness check for Vercel/uptime monitoring and
 * the first-deploy smoke test. Deliberately outside proxy.ts's matcher
 * (anything under /api/* is already excluded there), so it's reachable with
 * no session cookie. Returns only a boolean-shaped status — no row counts,
 * timestamps, or other data that could hint at what's actually in the DB.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
