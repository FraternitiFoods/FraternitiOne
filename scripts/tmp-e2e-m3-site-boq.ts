import "dotenv/config";
import { createThrowawayAdmin, deleteThrowawayAdmin, THROWAWAY_ADMIN_PASSWORD } from "./lib/throwaway-admin";
import { seedBoqFixture, removeBoqFixture, countBoqFixtureLeftovers } from "./lib/boq-fixture";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Milestone M3 (plan.md section 4, "Read-only screens") smoke check, run
 * against the throwaway fixture from scripts/lib/boq-fixture.ts, which this
 * script seeds and removes itself (3 sites, 3 categories, 10 items, one
 * explicit-zero rate on "Ladle Steel FIXTURE"). Hand-computed per-site totals:
 *   Site A (Fixture Site A) = 4,840 + 0 (Ladle Steel FIXTURE, missing rate) + 480 + 5,280 + 180,000 = 190,600
 *   Site B (Fixture Site B) = 2,420 + 480 + 5,280 + 180,000 = 188,180
 *   Site C (Fixture Site C) = 300 + 480 + 3,240 + 48,000 = 52,020
 * Only per-site figures are asserted: the fixture sits next to real data on the
 * shared preview DB, so grand totals / highest / lowest are not under its control.
 * Follows scripts/ci-smoke.ts's pattern (check() helper, one shared browser)
 * per CLAUDE.md's verification standard — kept, not throwaway, for reuse
 * when later milestones touch these same screens.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const ADMIN_EMAIL = "tmp-e2e-m3-admin@example.com"; // throwaway ADMIN, deleted in `finally` (not the real admin: its password is rotated)

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
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

const READ_ONLY_ROUTES = ["/site-boq", "/site-boq/site-view", "/site-boq/items", "/site-boq/vendors", "/site-boq/sites", "/site-boq/settings"];

async function main() {
  await createThrowawayAdmin(db, ADMIN_EMAIL);
  await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({
    data: { name: "Tmp E2E M3 Franchisee", email: FRANCHISEE_EMAIL, role: "FRANCHISEE", passwordHash },
  });

  await seedBoqFixture(db);
  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } });
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  if (!siteA || !kitchenSmallware) {
    throw new Error("Fixture data not found after seedBoqFixture() — check scripts/lib/boq-fixture.ts.");
  }

  const browser: Browser = await chromium.launch();

  try {
    const adminPage = await browser.newPage();
    await login(adminPage, ADMIN_EMAIL, THROWAWAY_ADMIN_PASSWORD);

    // ---- Overview: totals computed from the item/rate/site_item rules must match the hand-computed fixture numbers. ----
    await adminPage.goto(`${BASE}/site-boq`);
    const overviewText = await adminPage.locator("body").innerText();
    check("Overview lists the fixture sites", overviewText.includes("Fixture Site A") && overviewText.includes("Fixture Site C"));
    check("Overview site-total row for Site A = 1,90,600", overviewText.includes("1,90,600"));
    check("Overview site-total row for Site B = 1,88,180", overviewText.includes("1,88,180"));
    check("Overview site-total row for Site C = 52,020", overviewText.includes("52,020"));

    // ---- Site view: selecting Fixture Site A shows its banner counts (4 items with qty > 0, 1 missing rate: Ladle Steel FIXTURE). ----
    await adminPage.goto(`${BASE}/site-boq/site-view?site=${siteA.id}`);
    const siteViewText = await adminPage.locator("body").innerText();
    check("Site view renders the selected site's name", siteViewText.includes("Fixture Site A"));
    check("Site view shows the opening reminder table for all 3 sites", siteViewText.includes("Fixture Site B") && siteViewText.includes("Fixture Site C"));
    check("Site view 'what's pending' flags the missing-rate item", siteViewText.includes("Ladle Steel FIXTURE") && siteViewText.includes("No rate"));

    // ---- Items & Qty: Kitchen Smallware + Fixture Site A shows "No rate" on Ladle Steel FIXTURE (qty 10, rate normalized 0 -> null). ----
    await adminPage.goto(`${BASE}/site-boq/items?category=${kitchenSmallware.id}&site=${siteA.id}`);
    const itemsText = await adminPage.locator("body").innerText();
    check("Items & Qty shows Ladle Steel FIXTURE with 'No rate'", itemsText.includes("Ladle Steel FIXTURE") && itemsText.includes("No rate"));
    check("Items & Qty shows the Gogia FIXTURE vendor rate column", itemsText.includes("Gogia FIXTURE"));

    // ---- Vendors: grouped by category, contact fields visible (even if blank). ----
    await adminPage.goto(`${BASE}/site-boq/vendors`);
    // The route streams behind site-boq/loading.tsx, so wait for real content before reading (a bare innerText can read the skeleton).
    await adminPage.getByText("Wood Works FIXTURE").first().waitFor({ timeout: 20000 }).catch(() => {});
    const vendorsText = await adminPage.locator("body").innerText();
    check("Vendors page lists Gogia FIXTURE under Kitchen Smallware", vendorsText.includes("Kitchen Smallware") && vendorsText.includes("Gogia FIXTURE"));
    check("Vendors page lists Wood Works FIXTURE under Furniture", vendorsText.includes("Wood Works FIXTURE"));

    // ---- Sites: all 3 fixture sites listed. ----
    await adminPage.goto(`${BASE}/site-boq/sites`);
    const sitesText = await adminPage.locator("body").innerText();
    check(
      "Sites page lists all 3 fixture sites",
      sitesText.includes("Fixture Site A") && sitesText.includes("Fixture Site B") && sitesText.includes("Fixture Site C")
    );

    // ---- Settings: panel renders the mode without crashing, and no longer has the retired import-status card. ----
    await adminPage.goto(`${BASE}/site-boq/settings`);
    const settingsText = await adminPage.locator("body").innerText();
    check("Settings page shows the current mode", settingsText.includes("SHEET_LIVE") || settingsText.includes("WEBSITE_LIVE"));
    check("Settings page no longer shows an import status panel", !settingsText.includes("Import status"));

    await adminPage.close();

    // ---- Every new /site-boq/* route still 403s a FRANCHISEE user (plan.md section 2) via the shared forbidden.tsx. ----
    const franchiseePage = await browser.newPage();
    await login(franchiseePage, FRANCHISEE_EMAIL, THROWAWAY_PASSWORD);
    for (const route of READ_ONLY_ROUTES) {
      const resp = await franchiseePage.goto(`${BASE}${route}`);
      await franchiseePage.waitForLoadState("networkidle");
      // Under `pnpm dev` a segment with a loading.tsx streams its 403 screen after a 200 (plan.md progress log), so accept the rendered Forbidden page too.
      const body = await franchiseePage.locator("body").innerText();
      check(`franchisee hitting ${route} gets 403`, resp?.status() === 403 || (body.includes("403") && !body.includes("Fixture Site")));
    }
    await franchiseePage.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await removeBoqFixture(db).catch((e) => {
      console.error("Failed to remove the fixture:", e);
      failures++;
    });
    await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } }).catch((e) => {
      console.error("Failed to delete throwaway franchisee user:", e);
      failures++;
    });
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
