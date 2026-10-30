import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths — a length check up front
  // is fine here since it only leaks the expected secret's length, not its
  // value, and IMPORT_SECRET is a generated token, not a guessable password.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer secret check (plan.md section 7). No user session is involved —
 * this is the only credential the sheet's Apps Script push has.
 */
export function hasValidImportSecret(request: NextRequest): boolean {
  const expected = process.env.IMPORT_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  return safeEqual(match[1], expected);
}
