import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// webhook-processor.ts imports "server-only" — stub it, same pattern as
// src/lib/esign/webhook-processor.test.ts.
vi.mock("server-only", () => ({}));

const mockTx = {
  posOrder: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    aggregate: vi.fn(),
  },
  salesDay: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

const mockDb = {
  $transaction: vi.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
  posWebhookEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  franchiseProject: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { processPetpoojaWebhook } = await import("./webhook-processor");

const NOW = new Date("2026-01-10T12:00:00.000Z");
const LIVE_PROJECT = { id: "project-1", posLiveFrom: new Date("2020-01-01T00:00:00.000Z") };

/** A minimal, valid "orderdetails" payload — same field set as the PDF's basic sample (petpooja-parse.test.ts), trimmed. */
function makePayload(orderOverrides: Record<string, unknown> = {}, topOverrides: Record<string, unknown> = {}) {
  return {
    token: "right-token",
    event: "orderdetails",
    properties: {
      Restaurant: { restID: "rest-1" },
      Customer: { name: "Rohan", phone: "1234567890" },
      Order: {
        orderID: "order-1",
        customer_invoice_id: "inv-1",
        created_on: "2026-01-10 12:00:00",
        order_type: "Dine In",
        order_from: "POS",
        payment_type: "Cash",
        status: "Success",
        core_total: 1000,
        discount_total: 0,
        tax_total: 0,
        packaging_charge: 0,
        delivery_charges: 0,
        service_charge: 0,
        round_off: "0",
        total: 1000,
        comment: "do not leak this",
        biller: "someone",
        assignee: "someone else",
        ...orderOverrides,
      },
      Tax: [],
      Discount: [],
      OrderItem: [],
    },
    ...topOverrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PETPOOJA_WEBHOOK_TOKEN", "right-token");
  vi.stubEnv("PETPOOJA_WEBHOOK_PATH_SECRET", "right-secret");
  mockDb.posWebhookEvent.findFirst.mockResolvedValue(null);
  mockDb.franchiseProject.findUnique.mockResolvedValue(LIVE_PROJECT);
  mockTx.posOrder.findUnique.mockResolvedValue(null);
  mockTx.posOrder.aggregate.mockResolvedValue({ _sum: { coreTotal: 0, discountTotal: 0 }, _count: { _all: 0 } });
  mockTx.salesDay.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function send(payload: unknown) {
  return processPetpoojaWebhook(JSON.stringify(payload), undefined, { now: NOW });
}

describe("processPetpoojaWebhook — config and auth", () => {
  it("answers 503 and touches no table when neither secret is configured", async () => {
    // Explicit empty-string stubs, not vi.unstubAllEnvs() — unstubbing only
    // reverts to whatever the real .env on this machine happens to contain
    // (which may well be a real, non-empty PETPOOJA_WEBHOOK_TOKEN for local
    // manual testing against next dev, e.g. scripts/tmp-send-petpooja-sample.ts's
    // own precondition) rather than reliably "unset".
    vi.stubEnv("PETPOOJA_WEBHOOK_TOKEN", "");
    vi.stubEnv("PETPOOJA_WEBHOOK_PATH_SECRET", "");
    const result = await send(makePayload());
    expect(result.status).toBe(503);
    expect(result.body.outcome).toBe("MISCONFIGURED");
    expect(mockDb.posWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockDb.franchiseProject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a wrong body token with 401 and records REJECTED_AUTH with no payload", async () => {
    const result = await send(makePayload({}, { token: "wrong" }));
    expect(result.status).toBe(401);
    expect(result.body.outcome).toBe("REJECTED_AUTH");
    expect(mockDb.posWebhookEvent.create).toHaveBeenCalledWith({ data: { outcome: "REJECTED_AUTH" } });
    expect(mockDb.franchiseProject.findUnique).not.toHaveBeenCalled();
  });

  it("rate-limits REJECTED_AUTH logging — skips the write if one was recorded under a minute ago", async () => {
    mockDb.posWebhookEvent.findFirst.mockResolvedValue({ receivedAt: new Date(NOW.getTime() - 5_000) });
    const result = await send(makePayload({}, { token: "wrong" }));
    expect(result.status).toBe(401);
    expect(mockDb.posWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("accepts a valid body token (lowercase key) with no path secret", async () => {
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("PROCESSED");
  });

  it("accepts the capitalized Token key (the online-aggregator sample's spelling)", async () => {
    const payload = makePayload();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token: _token, ...rest } = payload as Record<string, unknown>;
    const result = await send({ ...rest, Token: "right-token" });
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("PROCESSED");
  });

  it("accepts a valid path secret even when the body token is wrong", async () => {
    const result = await processPetpoojaWebhook(
      JSON.stringify(makePayload({}, { token: "wrong" })),
      "right-secret",
      { now: NOW }
    );
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("PROCESSED");
  });

  it("rejects a malformed (non-JSON) body with 400, even with a correct path secret — never guesses", async () => {
    const result = await processPetpoojaWebhook("not json {{{", "right-secret", { now: NOW });
    expect(result.status).toBe(400);
    expect(result.body.outcome).toBe("FAILED");
    expect(mockDb.posWebhookEvent.create).toHaveBeenCalledWith({
      data: { outcome: "FAILED", error: "Payload is not a JSON object." },
    });
  });

  it("rejects an oversized body with 413 before parsing or touching the DB", async () => {
    const hugeBody = "a".repeat(1_000_001);
    const result = await processPetpoojaWebhook(hugeBody, "right-secret", { now: NOW });
    expect(result.status).toBe(413);
    expect(mockDb.posWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockDb.franchiseProject.findUnique).not.toHaveBeenCalled();
  });
});

describe("processPetpoojaWebhook — parsing and routing", () => {
  it("ignores a non-orderdetails event with 200 and no DB writes", async () => {
    const result = await send(makePayload({}, { event: "something_else" }));
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("IGNORED_EVENT");
    expect(mockDb.posWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockDb.franchiseProject.findUnique).not.toHaveBeenCalled();
  });

  it("stores a scrubbed payload (no Customer/comment/token) on a FAILED parse and answers 400", async () => {
    const result = await send(makePayload({ core_total: "not-a-number" }));
    expect(result.status).toBe(400);
    expect(result.body.outcome).toBe("FAILED");
    expect(mockDb.posWebhookEvent.create).toHaveBeenCalledTimes(1);
    const stored = mockDb.posWebhookEvent.create.mock.calls[0][0].data;
    expect(stored.outcome).toBe("FAILED");
    const serialized = JSON.stringify(stored.payload);
    expect(serialized).not.toContain("Rohan");
    expect(serialized).not.toContain("do not leak this");
    expect(serialized).not.toContain("right-token");
    expect(stored.payload.token).toBeUndefined();
    expect(stored.payload.properties.Customer).toBeUndefined();
    expect(stored.payload.properties.Order.comment).toBeUndefined();
  });

  it("rejects a businessDate more than 1 day in the future as FAILED (wrong clock)", async () => {
    const result = await send(makePayload({ created_on: "2026-01-20 12:00:00" }));
    expect(result.status).toBe(400);
    expect(result.body.outcome).toBe("FAILED");
  });

  it("records IGNORED_UNKNOWN_OUTLET with 200 and a scrubbed payload when restID matches no project", async () => {
    mockDb.franchiseProject.findUnique.mockResolvedValue(null);
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("IGNORED_UNKNOWN_OUTLET");
    expect(mockDb.posWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: "IGNORED_UNKNOWN_OUTLET", restId: "rest-1" }) })
    );
    expect(mockTx.posOrder.upsert).not.toHaveBeenCalled();
  });
});

describe("processPetpoojaWebhook — ingestion + SalesDay recompute", () => {
  it("upserts a new bill at revision 0 and recomputes SalesDay from the aggregate", async () => {
    mockTx.posOrder.aggregate.mockResolvedValue({ _sum: { coreTotal: 1000, discountTotal: 0 }, _count: { _all: 1 } });
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("PROCESSED");
    expect(mockTx.posOrder.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockTx.posOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.create.revision).toBe(0);
    expect(mockTx.salesDay.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ grossSales: 1000, netSales: 1000, orders: 1, source: "API" }),
      })
    );
  });

  it("resending an unchanged bill keeps the same revision and still recomputes (idempotent, no double count)", async () => {
    const existing = {
      invoiceNo: "inv-1",
      createdAtIst: new Date("2026-01-10T06:30:00.000Z"),
      businessDate: new Date("2026-01-10T00:00:00.000Z"),
      orderType: "Dine In",
      subOrderType: null,
      orderFrom: "POS",
      aggregatorOrderId: null,
      paymentType: "Cash",
      partPayments: null,
      status: "SUCCESS",
      coreTotal: 100_000, // ₹1000 in paise — matches makePayload()'s core_total: 1000 exactly
      discountTotal: 0,
      taxTotal: 0,
      packagingCharge: 0,
      deliveryCharge: 0,
      serviceCharge: 0,
      roundOff: 0,
      total: 100_000,
      flags: [],
      revision: 0,
    };
    mockTx.posOrder.findUnique.mockResolvedValue(existing);
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    const upsertArgs = mockTx.posOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.update.revision).toBe(0);
    expect(mockTx.salesDay.upsert).toHaveBeenCalledTimes(1);
  });

  it("bumps revision when a resend actually changes a value", async () => {
    const existing = {
      invoiceNo: "inv-1",
      createdAtIst: new Date("2026-01-10T06:30:00.000Z"),
      businessDate: new Date("2026-01-10T00:00:00.000Z"),
      orderType: "Dine In",
      subOrderType: null,
      orderFrom: "POS",
      aggregatorOrderId: null,
      paymentType: "Cash",
      partPayments: null,
      status: "SUCCESS",
      coreTotal: 50_000, // ₹500 — resend's makePayload() sends core_total: 1000 (₹1000), a real change
      discountTotal: 0,
      taxTotal: 0,
      packagingCharge: 0,
      deliveryCharge: 0,
      serviceCharge: 0,
      roundOff: 0,
      total: 50_000,
      flags: [],
      revision: 0,
    };
    mockTx.posOrder.findUnique.mockResolvedValue(existing);
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    const upsertArgs = mockTx.posOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.update.revision).toBe(1);
  });

  it("a Cancelled resend is stored but excluded from the SUCCESS-only aggregate", async () => {
    const existing = {
      invoiceNo: "inv-1",
      createdAtIst: new Date("2026-01-10T06:30:00.000Z"),
      businessDate: new Date("2026-01-10T00:00:00.000Z"),
      orderType: "Dine In",
      subOrderType: null,
      orderFrom: "POS",
      aggregatorOrderId: null,
      paymentType: "Cash",
      partPayments: null,
      status: "SUCCESS",
      coreTotal: 100_000,
      discountTotal: 0,
      taxTotal: 0,
      packagingCharge: 0,
      deliveryCharge: 0,
      serviceCharge: 0,
      roundOff: 0,
      total: 100_000,
      flags: [],
      revision: 0,
    };
    mockTx.posOrder.findUnique.mockResolvedValue(existing);
    mockTx.posOrder.aggregate.mockResolvedValue({ _sum: { coreTotal: 0, discountTotal: 0 }, _count: { _all: 0 } });
    const result = await send(makePayload({ status: "Cancelled" }));
    expect(result.status).toBe(200);
    const upsertArgs = mockTx.posOrder.upsert.mock.calls[0][0];
    expect(upsertArgs.update.status).toBe("CANCELLED");
    expect(mockTx.posOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SUCCESS" }) })
    );
    expect(mockTx.salesDay.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ grossSales: 0, netSales: 0, orders: 0 }) })
    );
  });

  it("stores a bill dated before posLiveFrom but does not touch SalesDay", async () => {
    mockDb.franchiseProject.findUnique.mockResolvedValue({ id: "project-1", posLiveFrom: new Date("2026-02-01T00:00:00.000Z") });
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(mockTx.posOrder.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.salesDay.findUnique).not.toHaveBeenCalled();
    expect(mockTx.salesDay.upsert).not.toHaveBeenCalled();
  });

  it("stores a bill but does not touch SalesDay when the project has no posLiveFrom set at all", async () => {
    mockDb.franchiseProject.findUnique.mockResolvedValue({ id: "project-1", posLiveFrom: null });
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(mockTx.posOrder.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.salesDay.upsert).not.toHaveBeenCalled();
  });

  it("does not overwrite a pinned day, but still upserts the PosOrder row", async () => {
    mockTx.salesDay.findUnique.mockResolvedValue({ isPinned: true });
    const result = await send(makePayload());
    expect(result.status).toBe(200);
    expect(mockTx.posOrder.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.posOrder.aggregate).not.toHaveBeenCalled();
    expect(mockTx.salesDay.upsert).not.toHaveBeenCalled();
  });

  it("answers 500 and records a FAILED event (best effort) when the transaction throws", async () => {
    mockDb.$transaction.mockRejectedValueOnce(new Error("DB is down"));
    const result = await send(makePayload());
    expect(result.status).toBe(500);
    expect(result.body.outcome).toBe("FAILED");
    expect(mockDb.posWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: "FAILED", restId: "rest-1", error: "DB is down" }) })
    );
  });
});
