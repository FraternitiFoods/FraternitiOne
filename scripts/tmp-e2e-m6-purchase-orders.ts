import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Purchase Orders (plan.md section 4.5), milestone M6: create (site,
 * category, vendor(s)/all vendors, PO date, delivery-by, GST %, payment
 * terms), preview, PDF download, PO list with search. Run with
 * `npx tsx scripts/tmp-e2e-m6-purchase-orders.ts` against a running `pnpm dev`.
 *
 * Reuses scripts/fixtures/boq-import-fixture.json (same fixture as the
 * M3/M5 scripts) — re-pushes it at the start AND in `finally`. Deliberately
 * leaves company settings and the vendor's contact fields blank (the import
 * never populates vendor contact details — plan.md section 7) so the main
 * scenario doubles as the "generate anyway, mark missing fields clearly"
 * check this session asked for, with no extra setup needed.
 *
 * Covers: the preview (lines filtered to qty > 0 + matching final vendor,
 * including a "No rate" line that still appears with amount 0), the GST
 * sum, creating the PO, the missing-fields notice on both the preview and
 * the detail page, the PDF download (status/content-type/magic bytes),
 * the list's search, and the "Locked site -> locked_rate" effective-rate
 * rule actually reaching a PO line.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");
const IMPORT_SECRET = process.env.IMPORT_SECRET!;
if (!IMPORT_SECRET) throw new Error("IMPORT_SECRET not set");

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function callImportApi(pathSuffix: string, body: unknown) {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${IMPORT_SECRET}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathSuffix} failed (${res.status}): ${JSON.stringify(json)}`);
  return json as { runId?: string };
}

async function pushFixture() {
  const fixture = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts/fixtures/boq-import-fixture.json"), "utf-8")
  ) as { sites: unknown[]; vendors: unknown[]; categories: { category: string }[] };

  const begin = await callImportApi("/api/import/boq/begin", { dryRun: false });
  const runId = begin.runId!;
  await callImportApi("/api/import/boq/chunk", { runId, type: "sites", data: fixture.sites });
  await callImportApi("/api/import/boq/chunk", { runId, type: "vendors", data: fixture.vendors });
  for (const category of fixture.categories) {
    await callImportApi("/api/import/boq/chunk", { runId, type: "category", data: category });
  }
  await callImportApi("/api/import/boq/finish", { runId });
}

async function setMode(mode: "SHEET_LIVE" | "WEBSITE_LIVE") {
  await db.appSetting.upsert({ where: { key: "mode" }, update: { value: mode }, create: { key: "mode", value: mode } });
}

async function main() {
  await setMode("SHEET_LIVE"); // pushFixture requires SHEET_LIVE (the import endpoints 403 in WEBSITE_LIVE).
  await pushFixture();

  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } }); // "Fixture Site A"
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  const gogia = await db.vendor.findFirst({ where: { name: "Gogia" } });
  const gnPan = await db.item.findUnique({ where: { sourceKey: "ITM-FIX-001" } });
  const tongs = await db.item.findUnique({ where: { sourceKey: "ITM-FIX-004" } });
  if (!siteA || !kitchenSmallware || !gogia || !gnPan || !tongs) {
    throw new Error("Fixture data not found after pushFixture() — check scripts/fixtures/boq-import-fixture.json.");
  }

  // Company settings stay blank on purpose (see file header) — leaves the
  // "generate anyway, mark missing fields" path exercised without extra setup.
  await db.appSetting.upsert({
    where: { key: "poNumberPrefix" },
    update: { value: "FF-PO" },
    create: { key: "poNumberPrefix", value: "FF-PO" },
  });

  await setMode("WEBSITE_LIVE");

  const createdPoIds: string[] = [];
  const browser: Browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await login(page, "tech@fraterniti.co.in", DEV_PASSWORD);

    // ---- Lock Site A, then change GN Pan's rate — the PO line for a locked site must use locked_rate, not the live rate.
    // Every SiteItem's locked_rate is snapshotted at its *current* effective rate (mirroring lockSite()) — not just
    // GN Pan's — otherwise Tongs would read as "missing" once the site is locked (rateForAmount never falls back to
    // the live final rate while locked; a item with no snapshot of its own would wrongly show no rate at all). ----
    await db.siteItem.updateMany({ where: { siteId: siteA.id, itemId: gnPan.id }, data: { lockedRate: 605 } });
    await db.siteItem.updateMany({ where: { siteId: siteA.id, itemId: tongs.id }, data: { lockedRate: 80 } });
    await db.site.update({ where: { id: siteA.id }, data: { isLocked: true, lockedAt: new Date(), lockedById: null } });
    await db.vendorRate.updateMany({ where: { itemId: gnPan.id, vendorId: gogia.id }, data: { rate: 900 } }); // rate changes after the lock

    // ---- Preview: Fixture Site A + Kitchen Smallware + All vendors (defaults to Gogia, the only one). ----
    const newUrl = `${BASE}/site-boq/purchase-orders/new?site=${siteA.id}&category=${kitchenSmallware.id}`;
    await page.goto(newUrl);
    const bodyText = await page.locator("body").innerText();
    check('Preview section is titled with the vendor name "Gogia"', bodyText.includes("Gogia"));
    check("Preview includes GN Pan at the locked rate (8 x 605 = 4,840), not the changed live rate of 900", (await page.locator("tr", { hasText: "GN Pan" }).innerText()).includes("4,840"));
    check("Preview includes Ladle Steel marked 'No rate' (qty 10, missing rate) rather than being silently dropped", (await page.locator("tr", { hasText: "Ladle Steel" }).innerText()).includes("No rate"));
    check("Preview includes Tongs (qty 6 x rate 80 = 480)", (await page.locator("tr", { hasText: "Tongs" }).innerText()).includes("480"));

    // Subtotal = 4840 (GN Pan, locked) + 0 (Ladle Steel, no rate) + 480 (Tongs) = 5320. GST 18% = 957.60. Total = 6277.60.
    check("Subtotal sums correctly (5,320.00)", bodyText.includes("5,320.00"));
    check("GST at 18% is correct (957.60)", bodyText.includes("957.60"));
    check("Grand total is correct (6,277.60)", bodyText.includes("6,277.60"));
    check(
      "Missing-fields notice lists both company and vendor fields (settings/vendor contact details left blank)",
      bodyText.includes("Missing before sending:") && bodyText.includes("Company name") && bodyText.includes("Gogia GSTIN")
    );

    // ---- Create the PO(s). ----
    await page.getByRole("button", { name: "Create PO(s)" }).click();
    await page.waitForURL((url) => url.pathname === "/site-boq/purchase-orders", { timeout: 10000 });
    const listUrl = new URL(page.url());
    const createdIds = (listUrl.searchParams.get("created") ?? "").split(",").filter(Boolean);
    check("Exactly one PO was created (only Gogia has qty > 0 lines in this category/site)", createdIds.length === 1);
    createdPoIds.push(...createdIds);

    const listText = await page.locator("body").innerText();
    check('List page shows the "Created 1 purchase order" banner', listText.includes("Created 1 purchase order"));
    const createdRow = page.locator("tr", { hasText: "New" });
    check("The newly created row is tagged 'New'", (await createdRow.count()) === 1);
    const poNumberText = (await createdRow.locator("td").first().innerText()).trim();
    check("PO number matches the configured prefix/year format", /^FF-PO-\d{4}-\d{4}/.test(poNumberText));
    check("List row shows the correct grand total", (await createdRow.innerText()).includes("6,277.60"));

    // ---- Search by the PO number. ----
    const poNumber = poNumberText.replace(/\s*New\s*$/, "").trim();
    await page.goto(`${BASE}/site-boq/purchase-orders?q=${encodeURIComponent(poNumber)}`);
    check("Search by PO number finds exactly one row", (await page.locator("tbody tr").count()) === 1);
    await page.goto(`${BASE}/site-boq/purchase-orders?q=zzz-does-not-exist`);
    check("Search with no match shows the empty state", (await page.locator("body").innerText()).includes("No purchase orders match"));

    // ---- Detail page: missing-fields notice, correct snapshot values. ----
    await page.goto(`${BASE}/site-boq/purchase-orders/${createdIds[0]}`);
    const detailText = await page.locator("body").innerText();
    check("Detail page shows the PO number as its heading", detailText.includes(poNumber));
    check(
      "Detail page repeats the missing-fields notice (company + vendor contact details)",
      detailText.includes("Missing before sending:") && detailText.includes("Signatory name")
    );
    check("Detail page shows the frozen rate for GN Pan (605), not the live rate (900)", detailText.includes("605.00") && !detailText.includes("900.00"));

    // ---- Download the PDF: status 200, correct content-type, real PDF bytes. ----
    const pdfResponse = await page.context().request.get(`${BASE}/api/site-boq/purchase-orders/${createdIds[0]}/pdf`);
    check("PDF download responds 200", pdfResponse.status() === 200);
    check("PDF download has the correct content-type", (pdfResponse.headers()["content-type"] ?? "").includes("application/pdf"));
    const pdfBody = await pdfResponse.body();
    check("PDF body starts with the %PDF- magic bytes", pdfBody.subarray(0, 5).toString("ascii") === "%PDF-");
    check("PDF body is non-trivially sized (actually has content, not an empty stub)", pdfBody.length > 500);

    await page.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await setMode("SHEET_LIVE").catch((e) => {
      console.error("Failed to restore mode to SHEET_LIVE:", e);
      failures++;
    });
    if (createdPoIds.length > 0) {
      await db.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } }).catch((e) => {
        console.error("Failed to delete test purchase orders:", e);
        failures++;
      });
    }
    await db.site
      .update({ where: { id: siteA.id }, data: { isLocked: false, lockedAt: null, lockedById: null } })
      .catch(() => {});
    await db.siteItem.updateMany({ where: { siteId: siteA.id }, data: { lockedRate: null } }).catch(() => {});
    await db.vendorRate.updateMany({ where: { itemId: gnPan.id, vendorId: gogia.id }, data: { rate: 605 } }).catch(() => {});
    await pushFixture().catch((e) => {
      console.error("Failed to re-push the fixture during cleanup:", e);
      failures++;
    });
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
