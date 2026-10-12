/**
 * plan.md section 26 — pure, DB-free parsing/validation for Petpooja's
 * Global API webhook payload ("orderdetails" event). Same shape as
 * src/lib/sales/parse-csv.ts: plain JSON in, plain data out, no `server-only`
 * import, so it's unit-testable without a database and the route/ingestion
 * step (P3) stays a thin wrapper around it.
 *
 * Money (rule 4 — integer paise, never a guess) and time (rule 5 — `created_on`
 * has no timezone, treat as IST) are the two places a webhook payload is easy
 * to get subtly wrong, so both get their own careful handling here rather
 * than inline in the route.
 *
 * This module never reads `Customer`, `comment`, `token`/`Token`, `biller`,
 * `assignee`, `OrderItem`, `Tax` or `Discount` off the payload — not because
 * it filters them out, but because `ParsedPetpoojaOrder` below simply has no
 * field for them, so there is nothing to accidentally carry forward into a
 * DB row, a log line or an error message (rule 3).
 */

import { rupeesToPaise, dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";

export type PartPayment = { paymentType: string; amountPaise: number };

export type ParsedPetpoojaOrder = {
  restId: string;
  orderId: string;
  invoiceNo: string | null;
  /** Real UTC instant, converted from naive IST wall-clock text. */
  createdAtIst: Date;
  /** IST calendar date (`YYYY-MM-DD`) — the date part of `created_on`. */
  businessDate: string;
  orderType: string;
  subOrderType: string | null;
  orderFrom: string;
  aggregatorOrderId: string | null;
  paymentType: string;
  partPayments: PartPayment[] | null;
  status: "SUCCESS" | "CANCELLED";
  coreTotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  packagingChargePaise: number;
  deliveryChargePaise: number;
  serviceChargePaise: number;
  /** Signed — the only money field where that's true. */
  roundOffPaise: number;
  totalPaise: number;
  /** e.g. `TOTAL_MISMATCH` — set by this parser, never rejects the bill on its own. */
  flags: string[];
};

export type PetpoojaParseResult =
  | { kind: "ignored_event"; event: string }
  | { kind: "failed"; reason: string }
  | { kind: "parsed"; order: ParsedPetpoojaOrder };

export type ParsePetpoojaOptions = {
  /** Clock used for the "businessDate more than 1 day in the future" rule — injected so tests are deterministic. */
  now?: Date;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A trimmed non-empty string from a JSON string or number, else null. */
function asNonEmptyString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** Same as `asNonEmptyString` but an empty string is itself a valid "absent" signal, not a parse failure — matches fields like `order_from_id` that the payload sends as `""` when not applicable. */
function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return asNonEmptyString(value);
}

/**
 * A money field's raw JSON value (number or string) -> integer paise, reusing
 * the exact digit-based conversion `src/lib/sales/parse-csv.ts` already uses
 * for CSV cells (never `parseFloat * 100` — plan.md section 26 rule 4).
 * `allowNegative` is only ever true for `round_off`, the one signed field.
 */
function parsePetpoojaMoney(value: unknown, { allowNegative = false }: { allowNegative?: boolean } = {}): number | null {
  let text: string;
  if (typeof value === "number" && Number.isFinite(value)) {
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }

  let negative = false;
  if (text.startsWith("-")) {
    if (!allowNegative) return null;
    negative = true;
    text = text.slice(1);
  }

  const paise = rupeesToPaise(text);
  if (paise === null) return null;
  return negative ? -paise : paise;
}

/** `created_on`'s IST calendar date -> the real UTC instant it represents (IST = UTC+5:30, so the instant is the IST wall-clock reading minus 5:30). */
function istWallClockToUtcInstant(y: number, m: number, d: number, h: number, mi: number, s: number): Date | null {
  const utcIfItWereUtc = Date.UTC(y, m - 1, d, h, mi, s);
  // Reject calendar overflow (e.g. "2025-02-30") the same way parse-csv's
  // parseFlexibleDate does: Date.UTC silently normalizes out-of-range
  // components, so a round-trip check is what actually catches it.
  const check = new Date(utcIfItWereUtc);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi ||
    check.getUTCSeconds() !== s
  ) {
    return null;
  }
  return new Date(utcIfItWereUtc - IST_OFFSET_MS);
}

/** Today's IST calendar date (`YYYY-MM-DD`), given the real UTC instant `now`. */
function istTodayKey(now: Date): string {
  return toUtcDateKey(new Date(now.getTime() + IST_OFFSET_MS));
}

function addOneDay(dateKey: string): string {
  const d = dateKeyToDate(dateKey);
  d.setUTCDate(d.getUTCDate() + 1);
  return toUtcDateKey(d);
}

const CREATED_ON_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function parseCreatedOn(raw: unknown): { createdAtIst: Date; businessDate: string } | null {
  if (typeof raw !== "string") return null;
  const m = CREATED_ON_RE.exec(raw.trim());
  if (!m) return null;
  const [, yStr, moStr, dStr, hStr, miStr, sStr] = m;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const mi = Number(miStr);
  const s = Number(sStr);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

  const createdAtIst = istWallClockToUtcInstant(y, mo, d, h, mi, s);
  if (!createdAtIst) return null;

  return { createdAtIst, businessDate: `${yStr}-${moStr}-${dStr}` };
}

function parseStatus(raw: unknown): "SUCCESS" | "CANCELLED" | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "success") return "SUCCESS";
  if (normalized === "cancelled") return "CANCELLED";
  return null;
}

function parsePartPayments(raw: unknown): PartPayment[] | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return "invalid";

  const result: PartPayment[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return "invalid";
    const paymentType = asNonEmptyString(entry.payment_type);
    const amountPaise = parsePetpoojaMoney(entry.amount);
    if (!paymentType || amountPaise === null) return "invalid";
    // Only { payment_type, amount } kept (plan.md section 26 field mapping
    // table) — `custome_payment_type` and anything else on the entry is
    // deliberately dropped here, not just left unread.
    result.push({ paymentType, amountPaise });
  }
  return result;
}

/** ₹1 (plan.md section 26's cross-check tolerance), in paise. */
const TOTAL_MISMATCH_TOLERANCE_PAISE = 100;

export function parsePetpoojaPayload(raw: unknown, options: ParsePetpoojaOptions = {}): PetpoojaParseResult {
  const now = options.now ?? new Date();

  if (!isRecord(raw)) {
    return { kind: "failed", reason: "Payload is not a JSON object." };
  }

  const event = typeof raw.event === "string" ? raw.event : "";
  if (event !== "orderdetails") {
    return { kind: "ignored_event", event: event || "(missing)" };
  }

  const properties = raw.properties;
  if (!isRecord(properties)) {
    return { kind: "failed", reason: "Missing properties object." };
  }

  const restaurant = properties.Restaurant;
  if (!isRecord(restaurant)) {
    return { kind: "failed", reason: "Missing properties.Restaurant." };
  }
  const restIdRaw = asNonEmptyString(restaurant.restID);
  if (!restIdRaw) {
    return { kind: "failed", reason: "Missing properties.Restaurant.restID." };
  }
  const restId = restIdRaw.toLowerCase();

  const order = properties.Order;
  if (!isRecord(order)) {
    return { kind: "failed", reason: "Missing properties.Order." };
  }

  const orderId = asNonEmptyString(order.orderID);
  if (!orderId) {
    return { kind: "failed", reason: "Missing properties.Order.orderID." };
  }

  const invoiceNo = asOptionalString(order.customer_invoice_id);

  const createdOn = parseCreatedOn(order.created_on);
  if (!createdOn) {
    return { kind: "failed", reason: `Invalid created_on: ${JSON.stringify(order.created_on)}.` };
  }
  const todayIst = istTodayKey(now);
  if (createdOn.businessDate > addOneDay(todayIst)) {
    return { kind: "failed", reason: `businessDate ${createdOn.businessDate} is more than 1 day in the future.` };
  }

  const orderType = asNonEmptyString(order.order_type);
  if (!orderType) return { kind: "failed", reason: "Missing order_type." };

  const orderFrom = asNonEmptyString(order.order_from);
  if (!orderFrom) return { kind: "failed", reason: "Missing order_from." };

  const paymentType = asNonEmptyString(order.payment_type);
  if (!paymentType) return { kind: "failed", reason: "Missing payment_type." };

  const status = parseStatus(order.status);
  if (!status) {
    return { kind: "failed", reason: `Unknown status: ${JSON.stringify(order.status)}.` };
  }

  const subOrderType = asOptionalString(order.sub_order_type);
  const aggregatorOrderId = asOptionalString(order.order_from_id);

  const coreTotalPaise = parsePetpoojaMoney(order.core_total);
  if (coreTotalPaise === null) return { kind: "failed", reason: `Invalid core_total: ${JSON.stringify(order.core_total)}.` };

  const discountTotalPaise = parsePetpoojaMoney(order.discount_total);
  if (discountTotalPaise === null)
    return { kind: "failed", reason: `Invalid discount_total: ${JSON.stringify(order.discount_total)}.` };

  const taxTotalPaise = parsePetpoojaMoney(order.tax_total);
  if (taxTotalPaise === null) return { kind: "failed", reason: `Invalid tax_total: ${JSON.stringify(order.tax_total)}.` };

  const packagingChargePaise = parsePetpoojaMoney(order.packaging_charge);
  if (packagingChargePaise === null)
    return { kind: "failed", reason: `Invalid packaging_charge: ${JSON.stringify(order.packaging_charge)}.` };

  const deliveryChargePaise = parsePetpoojaMoney(order.delivery_charges);
  if (deliveryChargePaise === null)
    return { kind: "failed", reason: `Invalid delivery_charges: ${JSON.stringify(order.delivery_charges)}.` };

  const serviceChargePaise = parsePetpoojaMoney(order.service_charge);
  if (serviceChargePaise === null)
    return { kind: "failed", reason: `Invalid service_charge: ${JSON.stringify(order.service_charge)}.` };

  const roundOffPaise = parsePetpoojaMoney(order.round_off, { allowNegative: true });
  if (roundOffPaise === null) return { kind: "failed", reason: `Invalid round_off: ${JSON.stringify(order.round_off)}.` };

  const totalPaise = parsePetpoojaMoney(order.total);
  if (totalPaise === null) return { kind: "failed", reason: `Invalid total: ${JSON.stringify(order.total)}.` };

  const partPayments = parsePartPayments(order.part_payments);
  if (partPayments === "invalid") {
    return { kind: "failed", reason: "Invalid part_payments entry." };
  }

  const flags: string[] = [];
  const expectedTotal =
    coreTotalPaise -
    discountTotalPaise +
    taxTotalPaise +
    packagingChargePaise +
    deliveryChargePaise +
    serviceChargePaise +
    roundOffPaise;
  if (Math.abs(expectedTotal - totalPaise) > TOTAL_MISMATCH_TOLERANCE_PAISE) {
    flags.push("TOTAL_MISMATCH");
  }

  return {
    kind: "parsed",
    order: {
      restId,
      orderId,
      invoiceNo,
      createdAtIst: createdOn.createdAtIst,
      businessDate: createdOn.businessDate,
      orderType,
      subOrderType,
      orderFrom,
      aggregatorOrderId,
      paymentType,
      partPayments,
      status,
      coreTotalPaise,
      discountTotalPaise,
      taxTotalPaise,
      packagingChargePaise,
      deliveryChargePaise,
      serviceChargePaise,
      roundOffPaise,
      totalPaise,
      flags,
    },
  };
}
