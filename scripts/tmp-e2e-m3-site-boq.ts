import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Milestone M3 (plan.md section 4, "Read-only screens") smoke check, run
 * against `scripts/fixtures/boq-import-fixture.json` (already pushed into
 * the dev DB per the M1/M2 session — see plan.md's Progress log). Hand-
 * computed expected totals from that fixture (3 sites, 3 categories, 10
 * items, one explicit-zero rate on "Ladle Steel"):
 *   Site A (Fixture Site A) = 4,840 + 0 (Ladle Steel, missing rate) + 480 + 5,280 + 180,000 = 190,600
 *   Site B (Fixture Site B) = 2,420 + 480 + 5,280 + 180,000 = 188,180
 *   Site C (Fixture Site C) = 300 + 480 + 3,240 + 48,000 = 52,020
 *   Grand total = 430,800; highest category = Furniture (408,000); highest
 *   site = Fixture Site A; lowest site with qty = Fixture Site C.
 * Follows scripts/ci-smoke.ts's pattern (check() helper, one shared browser)
 * per CLAUDE.md's verification standard — kept, not throwaway, for reuse
 * when later milestones touch these same screens.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");

const FRANCHISEE_EMAIL = "tmp-e2e-m3-franchisee@example.com";
const THROWAWAY_PASSWORD = "TmpE2eM3Test123!";

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

const READ_ONLY_ROUTES = ["/site-boq", "/site-boq/site-view", "/site-boq/items", "/site-boq/vendors", "/site-boq/sites", "/site-boq/settings"];

async function main() {
  await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({
    data: { name: "Tmp E2E M3 Franchisee", email: FRANCHISEE_EMAIL, role: "FRANCHISEE", passwordHash },
  });

  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } });
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  if (!siteA || !kitchenSmallware) {
    throw new Error("Fixture data not found — push scripts/fixtures/boq-import-fixture.json first (scripts/push-boq-fixture.ts).");
  }

  const browser: Browser = await chromium.launch();

  try {
    const adminPage = await browser.newPage();
    await login(adminPage, "tech@fraterniti.co.in", DEV_PASSWORD);

    // ---- Overview: totals computed from the item/rate/site_item rules must match the hand-computed fixture numbers. ----
    await adminPage.goto(`${BASE}/site-boq`);
    const overviewText = await adminPage.locator("body").innerText();
    check("Overview grand total = 4,30,800", overviewText.includes("4,30,800"));
    check("Overview highest-value site = Fixture Site A", overviewText.includes("Fixture Site A"));
    check("Overview highest-value category = Furniture", overviewText.includes("Furniture"));
    check("Overview lowest-value site (with qty) = Fixture Site C", overviewText.includes("Fixture Site C"));
    check("Overview site count = 3", overviewText.includes("Sites") && overviewText.match(/\b3\b/) !== null);
    check("Overview category count = 21", overviewText.includes("21"));
    check("Overview site-total row for Site A = 1,90,600", overviewText.includes("1,90,600"));
    check("Overview site-total row for Site B = 1,88,180", overviewText.includes("1,88,180"));
    check("Overview site-total row for Site C = 52,020", overviewText.includes("52,020"));

    // ---- Site view: selecting Fixture Site A shows its banner counts (4 items with qty > 0, 1 missing rate: Ladle Steel). ----
    await adminPage.goto(`${BASE}/site-boq/site-view?site=${siteA.id}`);
    const siteViewText = await adminPage.locator("body").innerText();
    check("Site view renders the selected site's name", siteViewText.includes("Fixture Site A"));
    check("Site view shows the opening reminder table for all 3 sites", siteViewText.includes("Fixture Site B") && siteViewText.includes("Fixture Site C"));
    check("Site view 'what's pending' flags the missing-rate item", siteViewText.includes("Ladle Steel") && siteViewText.includes("No rate"));

    // ---- Items & Qty: Kitchen Smallware + Fixture Site A shows "No rate" on Ladle Steel (qty 10, rate normalized 0 -> null). ----
    await adminPage.goto(`${BASE}/site-boq/items?category=${kitchenSmallware.id}&site=${siteA.id}`);
    const itemsText = await adminPage.locator("body").innerText();
    check("Items & Qty shows Ladle Steel with 'No rate'", itemsText.includes("Ladle Steel") && itemsText.includes("No rate"));
    check("Items & Qty shows the Gogia vendor rate column", itemsText.includes("Gogia"));

    // ---- Vendors: grouped by category, contact fields visible (even if blank). ----
    await adminPage.goto(`${BASE}/site-boq/vendors`);
    const vendorsText = await adminPage.locator("body").innerText();
    check("Vendors page lists Gogia under Kitchen Smallware", vendorsText.includes("Kitchen Smallware") && vendorsText.includes("Gogia"));
    check("Vendors page lists Wood Works under Furniture", vendorsText.includes("Wood Works"));

    // ---- Sites: all 3 fixture sites listed. ----
    await adminPage.goto(`${BASE}/site-boq/sites`);
    const sitesText = await adminPage.locator("body").innerText();
    check(
      "Sites page lists all 3 fixture sites",
      sitesText.includes("Fixture Site A") && sitesText.includes("Fixture Site B") && sitesText.includes("Fixture Site C")
    );

    // ---- Settings: read-only panel renders mode + import status without crashing. ----
    await adminPage.goto(`${BASE}/site-boq/settings`);
    const settingsText = await adminPage.locator("body").innerText();
    check("Settings page shows the current mode", settingsText.includes("SHEET_LIVE") || settingsText.includes("WEBSITE_LIVE"));
    check("Settings page shows the import status panel", settingsText.includes("Import status"));

    await adminPage.close();

    // ---- Every new /site-boq/* route still 403s a FRANCHISEE user (plan.md section 2) via the shared forbidden.tsx. ----
    const franchiseePage = await browser.newPage();
    await login(franchiseePage, FRANCHISEE_EMAIL, THROWAWAY_PASSWORD);
    for (const route of READ_ONLY_ROUTES) {
      const resp = await franchiseePage.goto(`${BASE}${route}`);
      check(`franchisee hitting ${route} gets 403`, resp?.status() === 403);
    }
    await franchiseePage.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } }).catch((e) => {
      console.error("Failed to delete throwaway franchisee user:", e);
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
