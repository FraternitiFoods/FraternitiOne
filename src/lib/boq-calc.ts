/**
 * Site BOQ rate/amount rules (plan.md section 3 "Rate rules" and section 6.2
 * "Order status"). Pure functions only — no DB access — so the same rules
 * apply identically wherever an amount or an "ordered" flag is shown
 * (Overview, Site view, Items & Qty).
 */

/** Prisma's Decimal (and plain number/string) -> a plain number, or null. */
export function decToNumber(
  value: number | string | { toNumber(): number } | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value.toNumber();
}

/**
 * final_rate(item) (plan.md section 3): the chosen final vendor's rate, or
 * null if there's no final vendor or that vendor's rate is missing/0 — 0 is
 * never a real price.
 */
export function finalRateOf(
  finalVendorId: string | null,
  vendorRates: { vendorId: string; rate: number | null }[]
): number | null {
  if (!finalVendorId) return null;
  const match = vendorRates.find((vr) => vr.vendorId === finalVendorId);
  if (!match || !match.rate || match.rate <= 0) return null;
  return match.rate;
}

/**
 * The rate used for amount(site, item) (plan.md section 3 "Rate rules" and
 * section 3 "Site lock"): while the site is locked, the frozen `lockedRate`
 * always wins — not rate_override, not a later final-rate change. Otherwise
 * it's `rate_override` if set, else `final_rate`.
 */
export function rateForAmount(params: {
  isLocked: boolean;
  lockedRate: number | string | { toNumber(): number } | null;
  rateOverride: number | string | { toNumber(): number } | null;
  finalRate: number | null;
}): number | null {
  if (params.isLocked) return decToNumber(params.lockedRate);
  return decToNumber(params.rateOverride) ?? params.finalRate;
}

/** amount(site, item) = qty × rate (0 if either is missing). */
export function amountOf(qty: number, rate: number | null): number {
  return rate ? qty * rate : 0;
}

/**
 * Placeholder "Ordered / Not ordered" rule (plan.md section 6.2) until the
 * sheet owner confirms the real one (section 9): stage non-empty or
 * po_link non-empty.
 */
export function isOrdered(siteItem: { stage: string | null; poLink: string | null }): boolean {
  return Boolean(siteItem.stage?.trim()) || Boolean(siteItem.poLink?.trim());
}

/**
 * "Pending" = po_amount − advance_given (plan.md section 3 — formula still
 * unverified with the sheet owner, section 9). null when both inputs are
 * null (nothing to compute yet), not when either is individually missing.
 */
export function pendingAmount(poAmount: number | null, advanceGiven: number | null): number | null {
  if (poAmount === null && advanceGiven === null) return null;
  return (poAmount ?? 0) - (advanceGiven ?? 0);
}
