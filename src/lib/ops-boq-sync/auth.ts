import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer secret check for the script-only /api/ops-boq-sync/* routes. Its own
 * secret (OPS_BOQ_SYNC_SECRET), distinct from SHEET_SYNC_SECRET and
 * DASHBOARD_SYNC_SECRET: Suraj's "OPERATIONAL BOQ STATUS LIST" copy has its own
 * Apps Script project, so rotating any one of the secrets never affects the others.
 */
export function hasValidOpsBoqSyncSecret(request: NextRequest): boolean {
  const expected = process.env.OPS_BOQ_SYNC_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  return safeEqual(match[1], expected);
}
