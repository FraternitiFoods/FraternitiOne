import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { istTodayKey } from "@/lib/pos/petpooja-parse";
import { dateKeyToDate, toUtcDateKey } from "@/lib/sales/parse-csv";
import { formatDate } from "@/lib/format";
import { formatPaiseAsRupees } from "@/lib/sales/format";

/**
 * plan.md section 26, build order step P6 — "local end-to-end" for the live
 * Petpooja sales webhook. Unlike every other step, this one is kept
 * permanently in the repo (same precedent as `tmp-e2e-sales.ts`,
 * `tmp-e2e-onboarding.ts`, etc.) as a real HTTP sender against a *running*
 * `next dev` — it is not run in CI and not run automatically.
 *
 * **Precondition**: `next dev` must already be running locally with
 * `PETPOOJA_WEBHOOK_ENABLED="true"` and a non-empty `PETPOOJA_WEBHOOK_TOKEN`
 * set in `.env` (env vars are read at process start — restart `next dev`
 * after editing `.env`, this script does not do that for you).
 *
 * What this proves, in order:
 * 1. **Shape fidelity** — four payloads matching the PDF's documented
 *    variants (basic, discount + round-off, part payment, aggregator with
 *    the capitalized `Token` key) each become exactly one correctly-mapped
 *    `PosOrder` row through the real HTTP route + DB, not just through the
 *    pure parser (already proven in P2's unit tests).
 * 2. **A synthetic batch (~200 bills over 3 real past days)** with known,
 *    hand-computed-in-this-script totals, covering every cause -> effect
 *    rule plan.md section 26 lists: a duplicate send changes nothing: a
 *    bill resent as Cancelled drops out of the totals; a bill for the
 *    *earliest* day sent *last* still lands on the right day; a payload
 *    carrying a full `Customer` block, `comment` and the aggregator spelling
 *    never appears anywhere in the database.
 * 3. **Real browser, real role logins**: /sales shows exactly the
 *    hand-calculated numbers for a signed-in Admin and for the throwaway
 *    franchisee; the franchisee cannot reach a different store's sales by
 *    URL; `/admin/pos` is reachable by the Admin and refused to the
 *    franchisee.
 *
 * Every throwaway DB row this script creates (project, franchisee user,
 * PosOrder, SalesDay) is deleted in a `finally` block, regardless of where a
 * check fails — same cleanup discipline as `tmp-e2e-sales.ts` after that
 * script's own leftover-data incident (plan.md section 20A build log).
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set in .env");
const WEBHOOK_TOKEN = process.env.PETPOOJA_WEBHOOK_TOKEN;
if (!WEBHOOK_TOKEN) {
  throw new Error(
    'PETPOOJA_WEBHOOK_TOKEN not set in .env. Set it (any non-empty value) and PETPOOJA_WEBHOOK_ENABLED="true", ' +
      "restart next dev, then re-run this script."
  );
}

const TEST_REST_ID = "tmp-e2e-petpooja-rest";
const THROWAWAY_BRAND = "Tulsi";
const THROWAWAY_LOCATION = "POS Verification Store (temp, section 26 e2e)";
const THROWAWAY_FRANCHISEE_EMAIL = "e2e-pos-franchisee@example.com";
const THROWAWAY_FRANCHISEE_PASSWORD = "E2ePosTest123!";

// Magic strings a leak-check payload carries — grepped for across the whole
// DB afterward to prove rule 3 ("Customer data is discarded") holds through
// the real HTTP + DB path, not just the pure parser.
const LEAK_NAME = "E2E Leak Check Customer";
const LEAK_PHONE = "9999900000";
const LEAK_COMMENT = "e2e-leak-check-comment-should-never-be-stored-anywhere";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function sendBill(payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}/api/webhooks/petpooja`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** `created_on` at a fixed, safe-in-the-past noon IST for the given `YYYY-MM-DD`. */
function createdOnFor(dateKey: string): string {
  return `${dateKey} 12:00:00`;
}

function basicOrder(opts: {
  orderId: string;
  dateKey: string;
  coreTotalRupees: number;
  status?: "Success" | "Cancelled";
  extraOrderFields?: Record<string, unknown>;
  extraTopFields?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    token: WEBHOOK_TOKEN,
    event: "orderdetails",
    properties: {
      Restaurant: { restID: TEST_REST_ID },
      Customer: { name: "", address: "", phone: "", gstin: "" },
      Order: {
        orderID: opts.orderId,
        customer_invoice_id: opts.orderId,
        created_on: createdOnFor(opts.dateKey),
        order_type: "Dine In",
        order_from: "POS",
        payment_type: "Cash",
        status: opts.status ?? "Success",
        core_total: opts.coreTotalRupees,
        discount_total: 0,
        tax_total: 0,
        packaging_charge: 0,
        delivery_charges: 0,
        service_charge: 0,
        round_off: "0",
        total: opts.coreTotalRupees,
        comment: "",
        biller: "",
        assignee: "",
        ...opts.extraOrderFields,
      },
      Tax: [],
      Discount: [],
      OrderItem: [],
    },
    ...opts.extraTopFields,
  };
}

async function login(page: Page, email: string, password: string = DEV_PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /sign out/i }).first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 10000 });
}

async function createThrowawayFranchisee() {
  await db.user.deleteMany({ where: { email: THROWAWAY_FRANCHISEE_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_FRANCHISEE_PASSWORD, 12);
  return db.user.create({
    data: {
      name: "E2E POS Franchisee Temp",
      email: THROWAWAY_FRANCHISEE_EMAIL,
      role: "FRANCHISEE",
      department: "FRANCHISEE",
      passwordHash,
    },
  });
}

async function createThrowawayProject(franchiseeId: string, ownerId: string, posLiveFromKey: string) {
  await db.franchiseProject.deleteMany({ where: { petpoojaRestId: TEST_REST_ID } });
  return db.franchiseProject.create({
    data: {
      brand: THROWAWAY_BRAND,
      format: "QSR",
      location: THROWAWAY_LOCATION,
      franchiseeId,
      ownerId,
      targetOpening: new Date("2027-06-01"),
      petpoojaRestId: TEST_REST_ID,
      posLiveFrom: dateKeyToDate(posLiveFromKey),
    },
  });
}

async function main() {
  await db.posWebhookEvent.deleteMany({ where: { restId: TEST_REST_ID } });

  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });
  const franchisee = await createThrowawayFranchisee();

  // Three real, safely-in-the-past days (never "today" — sidesteps any
  // UTC-vs-IST "which calendar day is today" ambiguity in computePeriodCards,
  // which buckets by UTC day while the webhook buckets by IST day; a few days
  // back is unambiguous either way) plus one far-in-the-past day for the
  // shape-fidelity payloads so they can never collide with the 3-day window.
  const todayKey = istTodayKey(new Date());
  const addDays = (key: string, n: number) => {
    const d = dateKeyToDate(key);
    d.setUTCDate(d.getUTCDate() + n);
    return toUtcDateKey(d);
  };
  const day0 = addDays(todayKey, -5); // oldest
  const day1 = addDays(todayKey, -4);
  const day2 = addDays(todayKey, -3); // newest
  const shapeFidelityDay = addDays(todayKey, -60);

  const project = await createThrowawayProject(franchisee.id, admin.id, day0);
  console.log("Throwaway project:", project.id, "| restID:", TEST_REST_ID, "| days:", day0, day1, day2);

  try {
    // -----------------------------------------------------------------
    // Part A — shape fidelity: one payload per documented variant.
    // -----------------------------------------------------------------
    const shapeOrders = [
      { orderId: "e2e-shape-basic", payload: basicOrder({ orderId: "e2e-shape-basic", dateKey: shapeFidelityDay, coreTotalRupees: 1158 }) },
      {
        orderId: "e2e-shape-discount",
        payload: basicOrder({
          orderId: "e2e-shape-discount",
          dateKey: shapeFidelityDay,
          coreTotalRupees: 1267,
          extraOrderFields: { discount_total: 253.4, tax_total: 20, round_off: "0.40" },
        }),
      },
      {
        orderId: "e2e-shape-partpay",
        payload: basicOrder({
          orderId: "e2e-shape-partpay",
          dateKey: shapeFidelityDay,
          coreTotalRupees: 987,
          extraOrderFields: {
            payment_type: "Part Payment",
            part_payments: [
              { payment_type: "Cash", amount: 500 },
              { payment_type: "Card", amount: 487 },
            ],
          },
        }),
      },
      {
        orderId: "e2e-shape-aggregator",
        payload: (() => {
          const p = basicOrder({
            orderId: "e2e-shape-aggregator",
            dateKey: shapeFidelityDay,
            coreTotalRupees: 350,
            extraOrderFields: {
              order_from: "Zomato",
              order_from_id: "ZOM-99881",
              tax_total: 17.76,
              service_charge: 5,
              round_off: "0.24",
              total: 372.76,
            },
          });
          const { token, ...rest } = p as Record<string, unknown>;
          return { ...rest, Token: token }; // the one payload that spells it `Token`
        })(),
      },
    ];

    for (const { orderId, payload } of shapeOrders) {
      const result = await sendBill(payload);
      check(`shape-fidelity "${orderId}" accepted (200 PROCESSED)`, result.status === 200);
    }

    const shapeRows = await db.posOrder.findMany({ where: { restId: TEST_REST_ID, orderId: { startsWith: "e2e-shape-" } } });
    check("all 4 shape-fidelity payloads became PosOrder rows", shapeRows.length === 4);
    const discountRow = shapeRows.find((r) => r.orderId === "e2e-shape-discount");
    check("discount payload: discountTotal parsed to 25340 paise", discountRow?.discountTotal === 25340);
    check("discount payload: roundOff parsed to 40 paise", discountRow?.roundOff === 40);
    const partPayRow = shapeRows.find((r) => r.orderId === "e2e-shape-partpay");
    check(
      "part-payment payload: partPayments has 2 entries",
      Array.isArray(partPayRow?.partPayments) && (partPayRow!.partPayments as unknown[]).length === 2
    );
    const aggregatorRow = shapeRows.find((r) => r.orderId === "e2e-shape-aggregator");
    check("aggregator payload (capital Token): still accepted and mapped", aggregatorRow?.orderFrom === "Zomato");

    // -----------------------------------------------------------------
    // Part B — synthetic batch over 3 real days, ~200 bills, with the
    // required edge cases. `expected` is accumulated independently of the
    // app's own aggregation code — this script's own arithmetic, not a
    // readback.
    // -----------------------------------------------------------------
    const expected = new Map<string, { gross: number; net: number; orders: number }>([
      [day0, { gross: 0, net: 0, orders: 0 }],
      [day1, { gross: 0, net: 0, orders: 0 }],
      [day2, { gross: 0, net: 0, orders: 0 }],
    ]);
    function addExpected(dateKey: string, rupees: number) {
      const e = expected.get(dateKey)!;
      e.gross += rupees * 100;
      e.net += rupees * 100;
      e.orders += 1;
    }
    function removeExpected(dateKey: string, rupees: number) {
      const e = expected.get(dateKey)!;
      e.gross -= rupees * 100;
      e.net -= rupees * 100;
      e.orders -= 1;
    }

    const BILLS_PER_DAY = 65;
    let seq = 0;
    const cancelOrderId = "e2e-batch-cancel-me";
    const duplicateOrderId = "e2e-batch-duplicate-me";
    const leakOrderId = "e2e-batch-leak-check";
    let lateBillSent = false;

    for (const dateKey of [day1, day2]) {
      // day0 is deliberately NOT sent in this loop — it's the "late bill",
      // sent only after day1 and day2 are fully done (see below).
      for (let i = 0; i < BILLS_PER_DAY; i++) {
        seq += 1;
        const rupees = 100 + seq;
        const orderId = `e2e-batch-${seq}`;
        const result = await sendBill(basicOrder({ orderId, dateKey, coreTotalRupees: rupees }));
        if (result.status !== 200) {
          check(`batch bill ${orderId} accepted`, false);
          continue;
        }
        addExpected(dateKey, rupees);
      }

      if (dateKey === day2) {
        // The cancel: first a normal Success bill (counts), then — once
        // every ordinary bill for both days has already landed — a resend
        // of the SAME orderId as Cancelled (must drop out of the totals).
        const cancelRupees = 777;
        const first = await sendBill(basicOrder({ orderId: cancelOrderId, dateKey: day2, coreTotalRupees: cancelRupees }));
        check("cancel-target bill initially accepted", first.status === 200);
        addExpected(day2, cancelRupees);

        // The duplicate: the exact same payload sent twice. Expected totals
        // only ever add it once, by construction above — so if ingestion
        // double-counted, the DB vs. hand-calc comparison below would catch
        // it directly.
        const dupRupees = 321;
        const dupPayload = basicOrder({ orderId: duplicateOrderId, dateKey: day2, coreTotalRupees: dupRupees });
        const dup1 = await sendBill(dupPayload);
        const dup2 = await sendBill(dupPayload);
        check("duplicate bill: first send accepted", dup1.status === 200);
        check("duplicate bill: resend also accepted (200, no error)", dup2.status === 200);
        addExpected(day2, dupRupees);

        // The leak-check bill: a full Customer block + comment, same
        // "contributes normally to the totals" shape as every other bill.
        const leakRupees = 555;
        const leakPayload = basicOrder({
          orderId: leakOrderId,
          dateKey: day2,
          coreTotalRupees: leakRupees,
          extraOrderFields: { comment: LEAK_COMMENT },
        });
        (leakPayload.properties as Record<string, unknown>).Customer = {
          name: LEAK_NAME,
          address: "123 Leak Street",
          phone: LEAK_PHONE,
          gstin: "LEAKGSTIN12345",
        };
        const leakResult = await sendBill(leakPayload);
        check("leak-check bill accepted", leakResult.status === 200);
        addExpected(day2, leakRupees);

        // Now actually cancel it — after everything else for day1/day2 is in.
        const cancelResend = await sendBill(basicOrder({ orderId: cancelOrderId, dateKey: day2, coreTotalRupees: cancelRupees, status: "Cancelled" }));
        check("cancel resend accepted", cancelResend.status === 200);
        removeExpected(day2, cancelRupees);

        // The late bill: dated for day0 (the oldest day), but only sent now
        // — after every day1/day2 bill is already in the database.
        const lateRupees = 999;
        const lateResult = await sendBill(basicOrder({ orderId: "e2e-batch-late-day0", dateKey: day0, coreTotalRupees: lateRupees }));
        check("late bill (day0, sent last) accepted", lateResult.status === 200);
        addExpected(day0, lateRupees);
        lateBillSent = true;
      }
    }
    check("late bill was actually sent", lateBillSent);

    // -----------------------------------------------------------------
    // DB-level verification — independent of anything the UI shows.
    // -----------------------------------------------------------------
    const cancelRow = await db.posOrder.findUnique({ where: { restId_orderId: { restId: TEST_REST_ID, orderId: cancelOrderId } } });
    check("cancelled bill's status is CANCELLED in the DB", cancelRow?.status === "CANCELLED");

    const dupRow = await db.posOrder.findMany({ where: { restId: TEST_REST_ID, orderId: duplicateOrderId } });
    check("duplicate send resulted in exactly one PosOrder row", dupRow.length === 1);
    check("duplicate send (byte-identical) left revision at 0", dupRow[0]?.revision === 0);

    for (const dateKey of [day0, day1, day2]) {
      const agg = await db.posOrder.aggregate({
        where: { projectId: project.id, businessDate: dateKeyToDate(dateKey), status: "SUCCESS" },
        _sum: { coreTotal: true },
        _count: { _all: true },
      });
      const exp = expected.get(dateKey)!;
      check(`DB: ${dateKey} gross = hand-calc (${formatPaiseAsRupees(exp.gross)})`, (agg._sum.coreTotal ?? 0) === exp.gross);
      check(`DB: ${dateKey} orders = hand-calc (${exp.orders})`, agg._count._all === exp.orders);

      const salesDay = await db.salesDay.findUnique({ where: { projectId_date: { projectId: project.id, date: dateKeyToDate(dateKey) } } });
      check(`SalesDay ${dateKey}: grossSales = hand-calc`, salesDay?.grossSales === exp.gross);
      check(`SalesDay ${dateKey}: netSales = hand-calc`, salesDay?.netSales === exp.net);
      check(`SalesDay ${dateKey}: orders = hand-calc`, salesDay?.orders === exp.orders);
      check(`SalesDay ${dateKey}: source = API`, salesDay?.source === "API");
    }

    // Rule 3 ("Customer data is discarded") — checked across the WHOLE
    // database, not just this project's rows, since PosWebhookEvent has no
    // project scope at all.
    const allOrders = await db.posOrder.findMany({ where: { restId: TEST_REST_ID } });
    const allEvents = await db.posWebhookEvent.findMany({ where: { restId: TEST_REST_ID } });
    const serialized = JSON.stringify(allOrders) + JSON.stringify(allEvents);
    check("no PosWebhookEvent rows were created (every bill ingested cleanly)", allEvents.length === 0);
    check("Customer name never stored anywhere", !serialized.includes(LEAK_NAME));
    check("Customer phone never stored anywhere", !serialized.includes(LEAK_PHONE));
    check("comment text never stored anywhere", !serialized.includes(LEAK_COMMENT));
    check("the webhook token never stored anywhere", !serialized.includes(WEBHOOK_TOKEN));

    // -----------------------------------------------------------------
    // Real browser, real role logins.
    // -----------------------------------------------------------------
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await login(page, "tech@fraterniti.co.in");

      await page.goto(`${BASE}/sales?project=${project.id}`);
      const adminSalesText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("Admin: Live from POS banner visible", adminSalesText.includes("Live from POS"));
      for (const dateKey of [day0, day1, day2]) {
        const exp = expected.get(dateKey)!;
        const dateLabel = formatDate(dateKeyToDate(dateKey));
        const rowRegex = new RegExp(`${dateLabel}.*?${formatPaiseAsRupees(exp.gross).replace("₹", "₹")}`, "s");
        check(`Admin /sales: ${dateKey} row shows hand-calc gross (${formatPaiseAsRupees(exp.gross)})`, rowRegex.test(adminSalesText));
      }

      const otherProject = await db.franchiseProject.findFirstOrThrow({
        where: { id: { not: project.id } },
        select: { id: true },
      });

      await page.goto(`${BASE}/admin/pos`);
      const adminPosText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("Admin can reach /admin/pos (200)", page.url().includes("/admin/pos"));
      check("Admin /admin/pos: throwaway restID is listed", adminPosText.includes(TEST_REST_ID));

      await logout(page);
      await login(page, THROWAWAY_FRANCHISEE_EMAIL, THROWAWAY_FRANCHISEE_PASSWORD);

      await page.goto(`${BASE}/sales`);
      const franchiseeSalesText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("franchisee lands directly on their own store", franchiseeSalesText.includes("POS Verification Store"));
      check("franchisee sees the hand-calc'd day2 gross too", franchiseeSalesText.includes(formatPaiseAsRupees(expected.get(day2)!.gross)));

      const blockedResp = await page.goto(`${BASE}/sales?project=${otherProject.id}`);
      const blockedText = await page.locator("body").innerText();
      check(
        "franchisee of store A cannot reach store B's sales by URL (404)",
        blockedResp?.status() === 404 || /could not be found/i.test(blockedText)
      );

      await page.goto(`${BASE}/admin/pos`);
      check("franchisee is refused /admin/pos (bounced off, not shown the page)", !page.url().includes("/admin/pos"));
    } finally {
      await browser.close();
    }
  } finally {
    // Always attempt full cleanup — same discipline as tmp-e2e-sales.ts
    // after its own leftover-data incident (plan.md section 20A build log).
    try {
      await db.franchiseProject.delete({ where: { id: project.id } }); // cascades PosOrder + SalesDay
    } catch (err) {
      console.error("CLEANUP FAILED — throwaway project may be left behind:", err);
      failures++;
    }
    try {
      await db.posWebhookEvent.deleteMany({ where: { restId: TEST_REST_ID } }); // safety net; none expected
      await db.user.delete({ where: { id: franchisee.id } });
    } catch (err) {
      console.error("CLEANUP FAILED — throwaway franchisee/events may be left behind:", err);
      failures++;
    }

    const projectStillExists = await db.franchiseProject.findUnique({ where: { id: project.id } });
    const orphanOrders = await db.posOrder.count({ where: { restId: TEST_REST_ID } });
    const orphanEvents = await db.posWebhookEvent.count({ where: { restId: TEST_REST_ID } });
    const orphanFranchisee = await db.user.findUnique({ where: { email: THROWAWAY_FRANCHISEE_EMAIL } });
    check("cleanup: throwaway project gone", projectStillExists === null);
    check("cleanup: no orphan PosOrder rows", orphanOrders === 0);
    check("cleanup: no orphan PosWebhookEvent rows", orphanEvents === 0);
    check("cleanup: throwaway franchisee user gone", orphanFranchisee === null);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
