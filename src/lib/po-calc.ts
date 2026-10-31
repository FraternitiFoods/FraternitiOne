/**
 * Purchase Order line-building and totals (plan.md section 4.5). Pure
 * functions only — no DB access — so the preview page and the
 * createPurchaseOrders Server Action can both call the exact same code and
 * never disagree about what a PO contains.
 */
import type { ComputedItem } from "@/lib/boq-data";

export type PoLineCandidate = {
  itemId: string;
  name: string;
  remarkSize: string | null;
  qty: number;
  /** The effective rate (plan.md section 3: locked_rate > rate_override > final_rate), already computed by getComputedItems() — never re-derived here. */
  rate: number | null;
  hasRate: boolean;
  amount: number;
};

/**
 * plan.md section 4.5: "Lines = items for that site+category (qty > 0) whose
 * final vendor is the chosen vendor." `items` must already be filtered to the
 * chosen category by the caller (getComputedItems() returns every category).
 */
export function buildPoLineCandidates(params: {
  items: ComputedItem[];
  siteId: string;
  vendorId: string;
}): PoLineCandidate[] {
  const lines: PoLineCandidate[] = [];
  for (const item of params.items) {
    if (item.finalVendorId !== params.vendorId) continue;
    const entry = item.siteEntries.find((e) => e.siteId === params.siteId);
    if (!entry || entry.qty <= 0) continue;
    lines.push({
      itemId: item.id,
      name: item.name,
      remarkSize: entry.remarkSize,
      qty: entry.qty,
      rate: entry.rate,
      hasRate: entry.hasRate,
      amount: entry.amount,
    });
  }
  return lines;
}

/** Avoids float drift in money math (e.g. 0.1 + 0.2 !== 0.3) — every PO amount is rounded to paise before it's stored or displayed. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PoTotals = { subtotal: number; gstAmount: number; total: number };

/** plan.md section 6.6: "PO totals: subtotal, GST % (default 18), grand total." */
export function poTotals(lines: { amount: number }[], gstPercent: number): PoTotals {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const gstAmount = roundMoney((subtotal * gstPercent) / 100);
  const total = roundMoney(subtotal + gstAmount);
  return { subtotal, gstAmount, total };
}

/**
 * plan.md section 4.5 — "one or more vendors (or all vendors)". `selected`
 * comes straight from the form/query string (a "vendor" checkbox list plus
 * an "all" checkbox sharing the same name); empty or containing "all" means
 * every vendor linked to the category, otherwise just the ones explicitly
 * checked (ignoring any id that isn't actually linked to this category).
 */
export function resolveSelectedVendorIds(selected: string[], categoryVendorIds: string[]): string[] {
  if (selected.length === 0 || selected.includes("all")) return categoryVendorIds;
  const validIds = new Set(categoryVendorIds);
  return selected.filter((id) => validIds.has(id));
}

export type PoVendorPreview = {
  vendorId: string;
  vendorName: string;
  lines: PoLineCandidate[];
  totals: PoTotals;
};

/**
 * One preview (and, on submit, one PurchaseOrder) per vendor that actually
 * has qty > 0 lines — a vendor with none is silently skipped rather than
 * producing an empty PO.
 */
export function buildPoPreviews(params: {
  items: ComputedItem[];
  siteId: string;
  vendors: { id: string; name: string }[];
  gstPercent: number;
}): PoVendorPreview[] {
  return params.vendors
    .map((vendor) => {
      const lines = buildPoLineCandidates({ items: params.items, siteId: params.siteId, vendorId: vendor.id });
      return { vendorId: vendor.id, vendorName: vendor.name, lines, totals: poTotals(lines, params.gstPercent) };
    })
    .filter((preview) => preview.lines.length > 0);
}
