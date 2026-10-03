/**
 * plan.md section 20A — money is integer paise everywhere in this module,
 * never float (section 17's shared rule, restated for sales). This file is
 * the only place sales paise values become a rupee display string or an
 * average-order-value number — no other sales file should do its own
 * division/formatting.
 */

export function formatPaiseAsRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * AOV = net sales ÷ orders (plan.md section 20A). Returns paise, rounded to
 * the nearest paise — integer division only, never a float rupee amount.
 * Null when there are no orders (division by zero), which the caller renders
 * as "—" rather than 0 or Infinity.
 */
export function computeAovPaise(netSalesPaise: number, orders: number): number | null {
  if (orders <= 0) return null;
  return Math.round(netSalesPaise / orders);
}

export function sumPaise(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
