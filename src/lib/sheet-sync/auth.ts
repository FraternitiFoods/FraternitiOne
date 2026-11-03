import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer secret check for the script-only routes (docs/sheet-sync/
 * CLAUDE_CODE_HANDOFF.md section 2) — a separate secret from IMPORT_SECRET
 * (src/lib/import/auth.ts) so rotating one never affects the other. No user
 * session is involved; this is the only credential the sheet's Apps Script
 * sync has.
 */
export function hasValidSheetSyncSecret(request: NextRequest): boolean {
  const expected = process.env.SHEET_SYNC_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  return safeEqual(match[1], expected);
}
