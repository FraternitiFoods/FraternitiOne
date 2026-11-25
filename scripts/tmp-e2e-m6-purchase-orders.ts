import "dotenv/config";
import { createThrowawayAdmin, deleteThrowawayAdmin, THROWAWAY_ADMIN_PASSWORD } from "./lib/throwaway-admin";
import { seedBoqFixture, removeBoqFixture, countBoqFixtureLeftovers, readSetting, restoreSetting } from "./lib/boq-fixture";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Purchase Orders (plan.md section 4.5), milestone M6: create (site,
 * category, vendor(s)/all vendors, PO date, delivery-by, GST %, payment
 * terms), preview, PDF download, PO list with search. Run with
 * `npx tsx scripts/tmp-e2e-m6-purchase-orders.ts` against a running `pnpm dev`.
 *
 * Seeds the throwaway fixture from scripts/lib/boq-fixture.ts (same one as the
 * M3/M5 scripts) and removes it in `finally`. Blanks the company name /
 * signatory settings for the run (restored afterwards) and leaves the fixture
 * vendor's contact fields blank, so the main scenario doubles as the "generate
 * anyway, mark missing fields clearly" check.
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
const ADMIN_EMAIL = "tmp-e2e-m6-admin@example.com"; // throwaway ADMIN, deleted in `finally` (not the real admin: its password is rotated)

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function setMode(mode: "SHEET_LIVE" | "WEBSITE_LIVE") {
  await db.appSetting.upsert({ where: { key: "mode" }, update: { value: mode }, create: { key: "mode", value: mode } });
}

async function setSetting(key: string, value: string) {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

const TOUCHED_SETTINGS = ["mode", "poNumberPrefix", "companyName", "signatoryName"] as const;

async function main() {
  // Remember every setting this script changes so `finally` puts the DB back exactly as found.
  const originalSettings = new Map<string, Awaited<ReturnType<typeof readSetting>>>();
  for (const key of TOUCHED_SETTINGS) originalSettings.set(key, await readSetting(db, key));

  await createThrowawayAdmin(db, ADMIN_EMAIL);
  await seedBoqFixture(db);

  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } }); // "Fixture Site A"
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  const gogia = await db.vendor.findFirst({ where: { name: "Gogia FIXTURE" } });
  const gnPan = await db.item.findUnique({ where: { sourceKey: "ITM-FIX-001" } });
  const tongs = await db.item.findUnique({ where: { sourceKey: "ITM-FIX-004" } });
  if (!siteA || !kitchenSmallware || !gogia || !gnPan || !tongs) {
    throw new Error("Fixture data not found after seedBoqFixture() — check scripts/lib/boq-fixture.ts.");
  }

  // Company name / signatory blank on purpose (see file header) — exercises the
  // "generate anyway, mark missing fields" path regardless of real settings.
  await setSetting("poNumberPrefix", "FF-PO");
  await setSetting("companyName", "");
  await setSetting("signatoryName", "");

  await setMode("WEBSITE_LIVE");

  const createdPoIds: string[] = [];
  const browser: Browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await login(page, ADMIN_EMAIL, THROWAWAY_ADMIN_PASSWORD);

    // ---- Lock Site A, then change GN Pan FIXTURE's rate — the PO line for a locked site must use locked_rate, not the live rate.
    // Every SiteItem's locked_rate is snapshotted at its *current* effective rate (mirroring lockSite()) — not just
    // GN Pan FIXTURE's — otherwise Tongs FIXTURE would read as "missing" once the site is locked (rateForAmount never falls back to
    // the live final rate while locked; a item with no snapshot of its own would wrongly show no rate at all). ----
    await db.siteItem.updateMany({ where: { siteId: siteA.id, itemId: gnPan.id }, data: { lockedRate: 605 } });
    await db.siteItem.updateMany({ where: { siteId: siteA.id, itemId: tongs.id }, data: { lockedRate: 80 } });
    await db.site.update({ where: { id: siteA.id }, data: { isLocked: true, lockedAt: new Date(), lockedById: null } });
    await db.vendorRate.updateMany({ where: { itemId: gnPan.id, vendorId: gogia.id }, data: { rate: 900 } }); // rate changes after the lock

    // ---- Preview: Fixture Site A + Kitchen Smallware + All vendors (defaults to Gogia FIXTURE, the only one). ----
    const newUrl = `${BASE}/site-boq/purchase-orders/new?site=${siteA.id}&category=${kitchenSmallware.id}`;
    await page.goto(newUrl);
    const bodyText = await page.locator("body").innerText();
    check('Preview section is titled with the vendor name "Gogia FIXTURE"', bodyText.includes("Gogia FIXTURE"));
    check("Preview includes GN Pan FIXTURE at the locked rate (8 x 605 = 4,840), not the changed live rate of 900", (await page.locator("tr", { hasText: "GN Pan FIXTURE" }).innerText()).includes("4,840"));
    check("Preview includes Ladle Steel FIXTURE marked 'No rate' (qty 10, missing rate) rather than being silently dropped", (await page.locator("tr", { hasText: "Ladle Steel FIXTURE" }).innerText()).includes("No rate"));
    check("Preview includes Tongs FIXTURE (qty 6 x rate 80 = 480)", (await page.locator("tr", { hasText: "Tongs FIXTURE" }).innerText()).includes("480"));

    // Subtotal = 4840 (GN Pan FIXTURE, locked) + 0 (Ladle Steel FIXTURE, no rate) + 480 (Tongs FIXTURE) = 5320. GST 18% = 957.60. Total = 6277.60.
    check("Subtotal sums correctly (5,320.00)", bodyText.includes("5,320.00"));
    check("GST at 18% is correct (957.60)", bodyText.includes("957.60"));
    check("Grand total is correct (6,277.60)", bodyText.includes("6,277.60"));
    check(
      "Missing-fields notice lists both company and vendor fields (settings/vendor contact details left blank)",
      bodyText.includes("Missing before sending:") && bodyText.includes("Company name") && bodyText.includes("Gogia FIXTURE GSTIN")
    );

    // ---- Create the PO(s). ----
    await page.getByRole("button", { name: "Create PO(s)" }).click();
    await page.waitForURL((url) => url.pathname === "/site-boq/purchase-orders", { timeout: 10000 });
    const listUrl = new URL(page.url());
    const createdIds = (listUrl.searchParams.get("created") ?? "").split(",").filter(Boolean);
    check("Exactly one PO was created (only Gogia FIXTURE has qty > 0 lines in this category/site)", createdIds.length === 1);
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
    // The page streams behind site-boq/loading.tsx, so wait for the real content before reading it (a bare innerText right after goto can read the skeleton).
    await page.locator("tbody tr").first().waitFor({ timeout: 15000 }).catch(() => {});
    check("Search by PO number finds exactly one row", (await page.locator("tbody tr").count()) === 1);
    await page.goto(`${BASE}/site-boq/purchase-orders?q=zzz-does-not-exist`);
    const emptyStateShown = await page
      .getByText("No purchase orders match")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("Search with no match shows the empty state", emptyStateShown);

    // ---- Detail page: missing-fields notice, correct snapshot values. ----
    await page.goto(`${BASE}/site-boq/purchase-orders/${createdIds[0]}`);
    // The page streams behind site-boq/loading.tsx: wait for the real content before reading it (a bare innerText can read the skeleton).
    await page.getByText(poNumber).first().waitFor({ timeout: 30000 }).catch(() => {});
    const detailText = await page.locator("body").innerText();
    check("Detail page shows the PO number as its heading", detailText.includes(poNumber));
    check(
      "Detail page repeats the missing-fields notice (company + vendor contact details)",
      detailText.includes("Missing before sending:") && detailText.includes("Signatory name")
    );
    check("Detail page shows the frozen rate for GN Pan FIXTURE (605), not the live rate (900)", detailText.includes("605.00") && !detailText.includes("900.00"));

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
    // removeBoqFixture also deletes the POs created on the fixture site/vendor, and the audit events about them.
    await removeBoqFixture(db, { actorEmails: [ADMIN_EMAIL] }).catch((e) => {
      console.error("Failed to remove the fixture:", e);
      failures++;
    });
    for (const key of TOUCHED_SETTINGS) {
      await restoreSetting(db, key, originalSettings.get(key)).catch((e) => {
        console.error(`Failed to restore setting ${key}:`, e);
        failures++;
      });
    }
    await deleteThrowawayAdmin(db, ADMIN_EMAIL).catch((e) => {
      console.error("Failed to delete throwaway admin user:", e);
      failures++;
    });
    console.log("Fixture leftovers after cleanup:", JSON.stringify(await countBoqFixtureLeftovers(db)));
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
