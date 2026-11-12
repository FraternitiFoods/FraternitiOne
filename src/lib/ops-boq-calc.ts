/**
 * Operations BOQ pure calculations (no DB, no "server-only": the client table
 * and vitest import this). The ONLY derived number is
 * Pending = Amount - Advance Given; it is never stored (operations-boq-handoff.md
 * section 2) — every consumer recomputes it from these two inputs.
 */

/** Money is 2-dp decimal(14,2); round through cents so sums of 2-dp values don't drift (0.1 + 0.2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Amount minus advance (empty advance = 0). `null` when Amount is empty — the table shows "-". */
export function pendingAmount(amount: number | null, advanceGiven: number | null): number | null {
  if (amount === null) return null;
  return round2(amount - (advanceGiven ?? 0));
}

/** Advance given exceeds Amount: Pending goes negative — shown red with a warning, never blocks a save. */
export function advanceExceedsAmount(amount: number | null, advanceGiven: number | null): boolean {
  return amount !== null && advanceGiven !== null && advanceGiven > amount;
}

type MoneyRow = { amount: number | null; advanceGiven: number | null };

/** Bottom total row: sum of Amount, sum of Advance Given, sum of the per-row Pending (rows with no Amount have none). */
export function totalsOf(rows: MoneyRow[]): { amount: number; advanceGiven: number; pending: number } {
  let amount = 0;
  let advanceGiven = 0;
  let pending = 0;
  for (const row of rows) {
    amount += row.amount ?? 0;
    advanceGiven += row.advanceGiven ?? 0;
    pending += pendingAmount(row.amount, row.advanceGiven) ?? 0;
  }
  return { amount: round2(amount), advanceGiven: round2(advanceGiven), pending: round2(pending) };
}

/** "BOQs shared x / n". */
export function sharedCount(rows: { boqStatus: "NOT_SHARED" | "SHARED" }[]): { shared: number; total: number } {
  return { shared: rows.filter((r) => r.boqStatus === "SHARED").length, total: rows.length };
}

/**
 * Follow Up date is in the past AND money is still pending (> 0). Both dates are
 * "yyyy-mm-dd" strings, which order correctly as plain strings — and avoids any
 * timezone drift from Date objects (followUpDate is a calendar date, not an instant).
 */
export function isFollowUpOverdue(followUpDate: string | null, pending: number | null, todayIso: string): boolean {
  return followUpDate !== null && pending !== null && pending > 0 && followUpDate < todayIso;
}

/** Today's calendar date in India ("yyyy-mm-dd") — the team's timezone, same one format.ts uses. */
export function todayIsoIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * S.No for a user-added row: max(numeric S.No in the site) + 1. Fixed rows carry
 * display strings ("1", "1", "2", …) so non-numeric values are ignored.
 */
export function nextSno(existing: string[]): string {
  let max = 0;
  for (const sno of existing) {
    const n = Number(sno);
    if (Number.isFinite(n) && n > max) max = Math.floor(n);
  }
  return String(max + 1);
}
