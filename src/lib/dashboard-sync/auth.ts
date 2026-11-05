import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer secret check for the script-only /api/dashboard-sync/* routes.
 * Separate secret (DASHBOARD_SYNC_SECRET) from both IMPORT_SECRET and
 * SHEET_SYNC_SECRET — a different Apps Script project (a different sheet
 * copy) holds this one, so rotating any one of the three never affects the
 * others. No user session is involved; this is the only credential the
 * Dashboard sheet's Apps Script sync has.
 */
export function hasValidDashboardSyncSecret(request: NextRequest): boolean {
  const expected = process.env.DASHBOARD_SYNC_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  return safeEqual(match[1], expected);
}
