import "server-only";

import { db } from "@/lib/db";

const RUNNING_NUMBER_DIGITS = 4;

/** plan.md section 4.5 default format: `<prefix>-<YYYY>-<NNNN>`. */
export function formatPoNumber(prefix: string, year: number, runningNumber: number): string {
  return `${prefix}-${year}-${String(runningNumber).padStart(RUNNING_NUMBER_DIGITS, "0")}`;
}

/**
 * Parses the running-number suffix out of a PO number matching
 * `<prefix>-<year>-NNNN`, or null if it doesn't match (a different
 * prefix/year, or a non-numeric suffix).
 */
export function parseRunningNumber(poNumber: string, prefix: string, year: number): number | null {
  const expectedStart = `${prefix}-${year}-`;
  if (!poNumber.startsWith(expectedStart)) return null;
  const suffix = poNumber.slice(expectedStart.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

/**
 * Next running number for this prefix+year, derived from the highest existing
 * `PurchaseOrder.poNumber` rather than a separate counter row — numbers
 * naturally restart at 1 each year, or whenever the prefix is changed in
 * Settings, with no extra state to keep in sync. Low write concurrency
 * (a handful of office staff) makes this safe without row locking; a unique
 * constraint on `poNumber` still catches the rare simultaneous-create race,
 * and createPurchaseOrders retries by recomputing this on conflict.
 */
export async function nextPoRunningNumber(prefix: string, year: number): Promise<number> {
  const existing = await db.purchaseOrder.findMany({
    where: { poNumber: { startsWith: `${prefix}-${year}-` } },
    select: { poNumber: true },
  });
  let max = 0;
  for (const { poNumber } of existing) {
    const n = parseRunningNumber(poNumber, prefix, year);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}
