import "server-only";

import { timingSafeEqual } from "node:crypto";
import { Prisma, type PosOrder } from "@prisma/client";
import { db } from "@/lib/db";
import { parsePetpoojaPayload, isRecord, type ParsedPetpoojaOrder } from "@/lib/pos/petpooja-parse";
import { dateKeyToDate } from "@/lib/sales/parse-csv";

/**
 * plan.md section 26 — ingestion for `POST /api/webhooks/petpooja`. Same
 * thin-route + shared-processor shape as `src/lib/esign/webhook-processor.ts`
 * (section 19), with one deliberate divergence: this module never logs a
 * successful bill to `PosWebhookEvent` (decision 7 — `PosOrder` itself is the
 * ledger; the event table is only for problems).
 */

export type ProcessPetpoojaResult = {
  status: number;
  body: { ok: boolean; outcome: string; message?: string };
};

/** A body this large cannot be a real Petpooja bill — reject before parsing or storing anything (rule: never store a guess, and never let an oversized body reach JSON.parse/DB). */
const MAX_BODY_BYTES = 1_000_000;

/** Rule 2: a wrong secret must store nothing except a rejection counter, and must be rate-limited so an attacker cannot fill the table — one row per rolling window, not one per request. */
const REJECTED_AUTH_LOG_INTERVAL_MS = 60_000;

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** The doc says Petpooja can send `token`; the aggregator sample spells it `Token` — accept both (plan.md section 26 "Token vs URL secret"). */
function extractBodyToken(json: Record<string, unknown>): string | undefined {
  if (typeof json.token === "string") return json.token;
  if (typeof json.Token === "string") return json.Token;
  return undefined;
}

/**
 * Rule 3: `Customer`, `comment`, `token`/`Token`, `biller`, `assignee`,
 * `OrderItem`, `Tax`, `Discount` must never reach the database — this is the
 * one place a payload is stored (as a `PosWebhookEvent.payload`, for a
 * problem that needs a human to look at and possibly reprocess), so it scrubs
 * the same fields `petpooja-parse.ts` simply never reads. `structuredClone`
 * first since the caller may still hold a reference to the parsed JSON.
 */
function scrubPayloadForStorage(raw: Record<string, unknown>): Prisma.InputJsonValue {
  const clone = structuredClone(raw) as Record<string, unknown>;
  delete clone.token;
  delete clone.Token;
  if (isRecord(clone.properties)) {
    const properties = clone.properties as Record<string, unknown>;
    delete properties.Customer;
    delete properties.Tax;
    delete properties.Discount;
    delete properties.OrderItem;
    if (isRecord(properties.Order)) {
      const order = properties.Order as Record<string, unknown>;
      delete order.comment;
      delete order.biller;
      delete order.assignee;
    }
  }
  return clone as Prisma.InputJsonValue;
}

/** Never logs the rawBody, the token or the path secret (rule 3 / "never log the URL or the token"). `now` is the same injected clock the parser's future-date check uses — one clock per request, so a test (or a future retry-queue replay) can't disagree with itself about "how long ago". */
async function recordRejectedAuth(now: Date): Promise<void> {
  try {
    const recent = await db.posWebhookEvent.findFirst({
      where: { outcome: "REJECTED_AUTH" },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    });
    if (recent && now.getTime() - recent.receivedAt.getTime() < REJECTED_AUTH_LOG_INTERVAL_MS) {
      return;
    }
    await db.posWebhookEvent.create({ data: { outcome: "REJECTED_AUTH" } });
  } catch (err) {
    console.error("Failed to record a Petpooja REJECTED_AUTH event:", err);
  }
}

type PosOrderWriteData = {
  invoiceNo: string | null;
  createdAtIst: Date;
  businessDate: Date;
  orderType: string;
  subOrderType: string | null;
  orderFrom: string;
  aggregatorOrderId: string | null;
  paymentType: string;
  partPayments: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  status: "SUCCESS" | "CANCELLED";
  coreTotal: number;
  discountTotal: number;
  taxTotal: number;
  packagingCharge: number;
  deliveryCharge: number;
  serviceCharge: number;
  roundOff: number;
  total: number;
  flags: string[];
};

function toWriteData(order: ParsedPetpoojaOrder, businessDateValue: Date): PosOrderWriteData {
  return {
    invoiceNo: order.invoiceNo,
    createdAtIst: order.createdAtIst,
    businessDate: businessDateValue,
    orderType: order.orderType,
    subOrderType: order.subOrderType,
    orderFrom: order.orderFrom,
    aggregatorOrderId: order.aggregatorOrderId,
    paymentType: order.paymentType,
    partPayments: order.partPayments ?? Prisma.JsonNull,
    status: order.status,
    coreTotal: order.coreTotalPaise,
    discountTotal: order.discountTotalPaise,
    taxTotal: order.taxTotalPaise,
    packagingCharge: order.packagingChargePaise,
    deliveryCharge: order.deliveryChargePaise,
    serviceCharge: order.serviceChargePaise,
    roundOff: order.roundOffPaise,
    total: order.totalPaise,
    flags: order.flags,
  };
}

/** Did a resend actually change anything? Drives `revision` (plan.md section 26: "+1 only if something changed"). */
function hasOrderChanged(existing: PosOrder, data: PosOrderWriteData): boolean {
  return (
    existing.invoiceNo !== data.invoiceNo ||
    existing.createdAtIst.getTime() !== data.createdAtIst.getTime() ||
    existing.businessDate.getTime() !== data.businessDate.getTime() ||
    existing.orderType !== data.orderType ||
    existing.subOrderType !== data.subOrderType ||
    existing.orderFrom !== data.orderFrom ||
    existing.aggregatorOrderId !== data.aggregatorOrderId ||
    existing.paymentType !== data.paymentType ||
    JSON.stringify(existing.partPayments ?? null) !== JSON.stringify(data.partPayments === Prisma.JsonNull ? null : data.partPayments) ||
    existing.status !== data.status ||
    existing.coreTotal !== data.coreTotal ||
    existing.discountTotal !== data.discountTotal ||
    existing.taxTotal !== data.taxTotal ||
    existing.packagingCharge !== data.packagingCharge ||
    existing.deliveryCharge !== data.deliveryCharge ||
    existing.serviceCharge !== data.serviceCharge ||
    existing.roundOff !== data.roundOff ||
    existing.total !== data.total ||
    JSON.stringify(existing.flags) !== JSON.stringify(data.flags)
  );
}

/**
 * `SalesDay` for one `(projectId, date)`, recomputed as a direct indexed
 * aggregate over `PosOrder` (plan.md section 26 rule 6 — the two must never
 * disagree) rather than loaded into memory. Three reasons this is a no-op:
 * the project isn't live yet for this date (`posLiveFrom` unset or later),
 * the date is before `posLiveFrom`, or the day is pinned ("my number is the
 * truth" — new bills still count on /admin/pos, just not here).
 */
async function recomputeSalesDayForDate(
  tx: Prisma.TransactionClient,
  project: { id: string; posLiveFrom: Date | null },
  dateValue: Date
): Promise<void> {
  if (!project.posLiveFrom || dateValue < project.posLiveFrom) return;

  const existingSalesDay = await tx.salesDay.findUnique({
    where: { projectId_date: { projectId: project.id, date: dateValue } },
    select: { isPinned: true },
  });
  if (existingSalesDay?.isPinned) return;

  const agg = await tx.posOrder.aggregate({
    where: { projectId: project.id, businessDate: dateValue, status: "SUCCESS" },
    _sum: { coreTotal: true, discountTotal: true },
    _count: { _all: true },
  });
  const grossSales = agg._sum.coreTotal ?? 0;
  const netSales = grossSales - (agg._sum.discountTotal ?? 0);
  const orders = agg._count._all;

  await tx.salesDay.upsert({
    where: { projectId_date: { projectId: project.id, date: dateValue } },
    create: { projectId: project.id, date: dateValue, grossSales, netSales, orders, source: "API" },
    update: { grossSales, netSales, orders, source: "API" },
  });
}

/**
 * Upsert the one `PosOrder` row keyed on `(restId, orderId)`, then recompute
 * `SalesDay` for its business day — and, on the rare resend that actually
 * changes which day a bill belongs to, the *old* day too, so that day's
 * total can never go stale (same rule 6 concern as above).
 */
async function ingestParsedOrder(project: { id: string; posLiveFrom: Date | null }, order: ParsedPetpoojaOrder): Promise<void> {
  const businessDateValue = dateKeyToDate(order.businessDate);

  await db.$transaction(async (tx) => {
    const existing = await tx.posOrder.findUnique({
      where: { restId_orderId: { restId: order.restId, orderId: order.orderId } },
    });

    const data = toWriteData(order, businessDateValue);
    const changed = existing ? hasOrderChanged(existing, data) : true;
    const revision = existing ? (changed ? existing.revision + 1 : existing.revision) : 0;

    await tx.posOrder.upsert({
      where: { restId_orderId: { restId: order.restId, orderId: order.orderId } },
      create: { projectId: project.id, restId: order.restId, orderId: order.orderId, ...data, revision },
      update: { projectId: project.id, ...data, revision },
    });

    await recomputeSalesDayForDate(tx, project, businessDateValue);
    if (existing && existing.businessDate.getTime() !== businessDateValue.getTime()) {
      await recomputeSalesDayForDate(tx, project, existing.businessDate);
    }
  });
}

/**
 * plan.md section 26 "Webhook route rules" — auth first (constant-time,
 * accepts a body token and/or a URL path secret), then event filter, then
 * parse, then outlet lookup, then the one small transaction. Thin route
 * handlers (`route.ts`) just read the raw body and call this.
 */
export async function processPetpoojaWebhook(
  rawBody: string,
  pathSecret: string | undefined,
  options: { now?: Date } = {}
): Promise<ProcessPetpoojaResult> {
  const now = options.now ?? new Date();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { status: 413, body: { ok: false, outcome: "FAILED", message: "Payload too large." } };
  }

  const tokenConfigured = !!process.env.PETPOOJA_WEBHOOK_TOKEN;
  const pathSecretConfigured = !!process.env.PETPOOJA_WEBHOOK_PATH_SECRET;
  if (!tokenConfigured && !pathSecretConfigured) {
    console.error("Petpooja webhook received but neither PETPOOJA_WEBHOOK_TOKEN nor PETPOOJA_WEBHOOK_PATH_SECRET is configured.");
    return { status: 503, body: { ok: false, outcome: "MISCONFIGURED" } };
  }

  let json: unknown;
  let jsonValid = true;
  if (rawBody.trim() === "") {
    jsonValid = false;
  } else {
    try {
      json = JSON.parse(rawBody);
    } catch {
      jsonValid = false;
    }
  }

  const bodyToken = jsonValid && isRecord(json) ? extractBodyToken(json) : undefined;

  const pathSecretOk =
    pathSecretConfigured && typeof pathSecret === "string" && pathSecret.length > 0 &&
    constantTimeEquals(pathSecret, process.env.PETPOOJA_WEBHOOK_PATH_SECRET!);
  const tokenOk = tokenConfigured && typeof bodyToken === "string" && constantTimeEquals(bodyToken, process.env.PETPOOJA_WEBHOOK_TOKEN!);

  if (!pathSecretOk && !tokenOk) {
    await recordRejectedAuth(now);
    return { status: 401, body: { ok: false, outcome: "REJECTED_AUTH" } };
  }

  if (!jsonValid || !isRecord(json)) {
    await db.posWebhookEvent.create({ data: { outcome: "FAILED", error: "Payload is not a JSON object." } });
    return { status: 400, body: { ok: false, outcome: "FAILED", message: "Invalid JSON body." } };
  }

  const parsed = parsePetpoojaPayload(json, { now });

  if (parsed.kind === "ignored_event") {
    return { status: 200, body: { ok: true, outcome: "IGNORED_EVENT" } };
  }

  if (parsed.kind === "failed") {
    await db.posWebhookEvent.create({
      data: { outcome: "FAILED", error: parsed.reason, payload: scrubPayloadForStorage(json) },
    });
    return { status: 400, body: { ok: false, outcome: "FAILED", message: parsed.reason } };
  }

  const order = parsed.order;
  const project = await db.franchiseProject.findUnique({
    where: { petpoojaRestId: order.restId },
    select: { id: true, posLiveFrom: true },
  });

  if (!project) {
    await db.posWebhookEvent.create({
      data: { outcome: "IGNORED_UNKNOWN_OUTLET", restId: order.restId, payload: scrubPayloadForStorage(json) },
    });
    return { status: 200, body: { ok: true, outcome: "IGNORED_UNKNOWN_OUTLET" } };
  }

  try {
    await ingestParsedOrder(project, order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    console.error("Petpooja webhook ingestion failed:", err);
    try {
      await db.posWebhookEvent.create({
        data: { outcome: "FAILED", restId: order.restId, error: message, payload: scrubPayloadForStorage(json) },
      });
    } catch (loggingErr) {
      console.error("Also failed to record the Petpooja FAILED event:", loggingErr);
    }
    return { status: 500, body: { ok: false, outcome: "FAILED", message: "Internal error." } };
  }

  return { status: 200, body: { ok: true, outcome: "PROCESSED" } };
}
