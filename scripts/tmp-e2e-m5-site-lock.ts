import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Site lock (plan.md section 3 "Site lock" + section 5's own row), the part
 * M5's first pass explicitly left out (see plan.md's 2026-10-31 Progress log
 * entry): the lock/unlock UI, the locked_rate freeze, the shared
 * rateForAmount function, the lock badge, read-only + tooltip on a locked
 * site's fields, and the per-site rate_override edit. Run with
 * `npx tsx scripts/tmp-e2e-m5-site-lock.ts` against a running `pnpm dev`.
 *
 * Reuses scripts/fixtures/boq-import-fixture.json (same fixture as the M3/M5
 * scripts) — re-pushes it at the start AND in `finally` so this is
 * self-sufficient regardless of what another script last did to the dev DB.
 *
 * Covers: locking via the Sites page button + confirmation dialog; the
 * locked_rate snapshot freezing a site's amount even after the item's final
 * rate changes, while an unlocked site keeps following it; the lock badge on
 * Overview/Site view/Items & Qty/Sites; qty/remark/tracking/rate-override all
 * becoming read-only with a "Site is locked" tooltip; a per-site rate
 * override showing an "Overridden" marker and changing the amount; unlocking
 * via the Site view page's button + its own confirmation dialog, which
 * resumes following rate changes; and that locking also works in SHEET_LIVE
 * (plan.md section 3: "Locking/unlocking is allowed in SHEET_LIVE mode").
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
  const siteB = await db.site.findUnique({ where: { sourceKey: "S-FIX-002" } }); // "Fixture Site B"
  const siteC = await db.site.findUnique({ where: { sourceKey: "S-FIX-003" } }); // "Fixture Site C"
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  const gogia = await db.vendor.findFirst({ where: { name: "Gogia" } });
  if (!siteA || !siteB || !siteC || !kitchenSmallware || !gogia) {
    throw new Error("Fixture data not found after pushFixture() — check scripts/fixtures/boq-import-fixture.json.");
  }
  const itemsUrlFor = (siteId: string) => `${BASE}/site-boq/items?site=${siteId}&category=${kitchenSmallware.id}`;
  const siteViewUrlFor = (siteId: string) => `${BASE}/site-boq/site-view?site=${siteId}`;

  await setMode("WEBSITE_LIVE");

  const browser: Browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await login(page, "tech@fraterniti.co.in", DEV_PASSWORD);

    // ---- Lock Site A from the Sites page, with its confirmation dialog (plan.md section 3). ----
    await page.goto(`${BASE}/site-boq/sites`);
    const siteARow = page.locator("tr", { hasText: "Fixture Site A" });
    check("Before locking: no 'Locked' badge on Fixture Site A", (await siteARow.getByText("Locked").count()) === 0);
    await siteARow.getByRole("button", { name: "Lock" }).click();
    const lockDialog = page.getByRole("dialog");
    const lockDialogText = await lockDialog.innerText();
    check(
      "Lock confirmation explains the freeze plainly",
      lockDialogText.includes("frozen") && lockDialogText.includes("will not change this site's amounts")
    );
    await lockDialog.getByRole("button", { name: "Lock site" }).click();
    await lockDialog.waitFor({ state: "hidden", timeout: 5000 });
    check("After locking: 'Locked' badge shown on the Sites page", (await siteARow.getByText("Locked").count()) === 1);
    check("After locking: the button now reads 'Unlock'", (await siteARow.getByRole("button", { name: "Unlock" }).count()) === 1);

    // ---- Lock badge shows everywhere the site appears (Overview, Site view, Items & Qty). ----
    await page.goto(`${BASE}/site-boq`);
    check(
      "Lock badge shown on Overview next to the site name",
      (await page.locator("tr", { hasText: "Fixture Site A" }).getByText("Locked").count()) === 1
    );

    await page.goto(siteViewUrlFor(siteA.id));
    check(
      "Lock badge shown on Site view",
      (await page.locator("h2", { hasText: "By category" }).getByText("Locked").count()) === 1
    );
    check("Site view also exposes an Unlock button for the locked, selected site", (await page.getByRole("button", { name: "Unlock" }).count()) === 1);

    await page.goto(itemsUrlFor(siteA.id));
    const lockedBodyText = await page.locator("body").innerText();
    check("Items & Qty shows the locked-site banner", lockedBodyText.includes("is locked") && lockedBodyText.includes("rate override"));

    // ---- Locked site: qty/remark read-only with a "Site is locked" tooltip; the server guard backs this up either way. ----
    const gnPanRow = page.locator("tr", { hasText: "GN Pan" });
    check("Locked site: no qty input rendered for GN Pan", (await gnPanRow.locator('input[name="qty"]').count()) === 0);
    const qtyTitle = await gnPanRow.locator("td").nth(2).locator("span").first().getAttribute("title");
    check('Locked site: qty cell tooltip says "Site is locked"', qtyTitle === "Site is locked");
    const remarkTitle = await gnPanRow.locator("td").nth(1).locator("span").first().getAttribute("title");
    check('Locked site: remark cell tooltip says "Site is locked"', remarkTitle === "Site is locked");

    const amountBeforeRateChange = (await gnPanRow.locator("td").nth(5).innerText()).trim();
    check("GN Pan's amount at Site A before the rate change is recorded", amountBeforeRateChange.includes("4,840"));

    await gnPanRow.getByRole("button", { name: "Tracking" }).click();
    const trackingDialog = page.getByRole("dialog", { name: /Order tracking/i });
    const stageInput = trackingDialog.locator("#stage");
    check("Locked site: Stage field is disabled in the tracking drawer", !(await stageInput.isEnabled()));
    check('Locked site: Stage field tooltip says "Site is locked"', (await stageInput.getAttribute("title")) === "Site is locked");
    const overrideInput = trackingDialog.locator("#rateOverride");
    check("Locked site: rate override field is disabled even for Admin", !(await overrideInput.isEnabled()));
    check(
      'Locked site: rate override tooltip says "Site is locked"',
      (await overrideInput.getAttribute("title")) === "Site is locked"
    );
    check("Locked site: no Save button next to the rate override (blocked)", (await trackingDialog.getByRole("button", { name: "Save" }).count()) === 0);
    await trackingDialog.getByRole("button", { name: "Close" }).first().click();

    // ---- Change the item's final rate while Site A is locked. ----
    await gnPanRow.getByRole("button", { name: "Edit" }).click();
    const itemDialog = page.getByRole("dialog", { name: /Edit GN Pan/i });
    const rateInput = itemDialog.locator(`input[name="rate_${gogia.id}"]`);
    await rateInput.fill("900");
    await itemDialog.getByRole("button", { name: "Save changes" }).click();
    await itemDialog.waitFor({ state: "hidden", timeout: 5000 });

    await page.reload();
    const gnPanRowAfter = page.locator("tr", { hasText: "GN Pan" });
    check("Final rate column reflects the new catalog rate (₹900)", (await gnPanRowAfter.locator("td").nth(4).innerText()).includes("900"));
    const amountAfterRateChange = (await gnPanRowAfter.locator("td").nth(5).innerText()).trim();
    check("Locked Site A's amount is frozen — unchanged by the rate change", amountAfterRateChange === amountBeforeRateChange);

    // ---- An unlocked site (B) follows the new rate. ----
    await page.goto(itemsUrlFor(siteB.id));
    const gnPanAtSiteB = page.locator("tr", { hasText: "GN Pan" });
    check(
      "Unlocked Site B's GN Pan amount follows the new rate (qty 4 × 900 = 3,600)",
      (await gnPanAtSiteB.locator("td").nth(5).innerText()).includes("3,600")
    );

    // ---- Per-site rate override (Admin, WEBSITE_LIVE, not locked) on Tongs at Site B. ----
    const tongsRowB = page.locator("tr", { hasText: "Tongs" });
    const amountBeforeOverride = (await tongsRowB.locator("td").nth(5).innerText()).trim();
    check("Tongs at Site B starts with no 'Override' marker", (await tongsRowB.getByText("Override").count()) === 0);

    await tongsRowB.getByRole("button", { name: "Tracking" }).click();
    const tongsDrawer = page.getByRole("dialog", { name: /Order tracking/i });
    check("Unlocked site: no 'Overridden' badge before setting one", (await tongsDrawer.getByText("Overridden").count()) === 0);
    const tongsOverrideInput = tongsDrawer.locator("#rateOverride");
    check("Unlocked site: rate override field is enabled for Admin", await tongsOverrideInput.isEnabled());
    await tongsOverrideInput.fill("50");
    // The rate-override form is the first <form> in the drawer (rendered above the tracking-fields form), so scope to it — both forms have a "Save" button.
    await tongsDrawer.locator("form").first().getByRole("button", { name: "Save" }).click();
    await tongsDrawer.waitFor({ state: "hidden", timeout: 5000 });

    await page.reload();
    const tongsRowBAfter = page.locator("tr", { hasText: "Tongs" });
    check("Tongs at Site B now shows the 'Override' marker on the Amount cell", (await tongsRowBAfter.getByText("Override").count()) === 1);
    const amountAfterOverride = (await tongsRowBAfter.locator("td").nth(5).innerText()).trim();
    check(
      "Tongs amount reflects the override (qty 6 × 50 = 300), different from before",
      amountAfterOverride.includes("300.00") && amountAfterOverride !== amountBeforeOverride
    );
    await tongsRowBAfter.getByRole("button", { name: "Tracking" }).click();
    const tongsDrawerAfter = page.getByRole("dialog", { name: /Order tracking/i });
    check("Tracking drawer shows the 'Overridden' badge next to the field", (await tongsDrawerAfter.getByText("Overridden").count()) === 1);
    await tongsDrawerAfter.getByRole("button", { name: "Close" }).first().click();

    // ---- Unlock Site A from the Site view page, with its own confirmation dialog. ----
    await page.goto(siteViewUrlFor(siteA.id));
    await page.getByRole("button", { name: "Unlock" }).click();
    const unlockDialog = page.getByRole("dialog");
    const unlockDialogText = await unlockDialog.innerText();
    check(
      "Unlock confirmation explains edits resume (distinct copy from the lock dialog)",
      unlockDialogText.includes("editable again") && !unlockDialogText.includes("will not change this site's amounts")
    );
    await unlockDialog.getByRole("button", { name: "Unlock site" }).click();
    await unlockDialog.waitFor({ state: "hidden", timeout: 5000 });
    check("After unlocking: no 'Locked' badge on Site view", (await page.locator("h2", { hasText: "By category" }).getByText("Locked").count()) === 0);

    // ---- Unlocked Site A: edits resume, and its amount now follows the live rate again (no override of its own). ----
    await page.goto(itemsUrlFor(siteA.id));
    const gnPanRowUnlocked = page.locator("tr", { hasText: "GN Pan" });
    check("Unlocked Site A: qty input is rendered again", (await gnPanRowUnlocked.locator('input[name="qty"]').count()) === 1);
    check(
      "Unlocked Site A: GN Pan's amount now follows the live rate (qty 8 × 900 = 7,200)",
      (await gnPanRowUnlocked.locator("td").nth(5).innerText()).includes("7,200")
    );
    await gnPanRowUnlocked.getByRole("button", { name: "Tracking" }).click();
    const unlockedDrawer = page.getByRole("dialog", { name: /Order tracking/i });
    check("Unlocked Site A: Stage field is enabled again", await unlockedDrawer.locator("#stage").isEnabled());
    check("Unlocked Site A: rate override field is enabled again for Admin", await unlockedDrawer.locator("#rateOverride").isEnabled());
    await unlockedDrawer.getByRole("button", { name: "Close" }).first().click();

    // ---- Audit log recorded who/when/which-site for both the lock and the unlock. ----
    await page.goto(`${BASE}/site-boq/settings`);
    const auditText = await page.locator("body").innerText();
    check('Audit log shows the lock event ("Locked \\"Fixture Site A\\"")', auditText.includes('Locked "Fixture Site A"'));
    check('Audit log shows the unlock event ("Unlocked \\"Fixture Site A\\"")', auditText.includes('Unlocked "Fixture Site A"'));

    // ---- Locking also works in SHEET_LIVE (plan.md section 3: lock/unlock bypasses the mode gate). ----
    await setMode("SHEET_LIVE");
    await page.goto(`${BASE}/site-boq/sites`);
    const siteCRow = page.locator("tr", { hasText: "Fixture Site C" });
    await siteCRow.getByRole("button", { name: "Lock" }).click();
    const siteCLockDialog = page.getByRole("dialog");
    await siteCLockDialog.getByRole("button", { name: "Lock site" }).click();
    await siteCLockDialog.waitFor({ state: "hidden", timeout: 5000 });
    check("SHEET_LIVE: locking Site C still works (lock bypasses the mode gate)", (await siteCRow.getByText("Locked").count()) === 1);
    await siteCRow.getByRole("button", { name: "Unlock" }).click();
    const siteCUnlockDialog = page.getByRole("dialog");
    await siteCUnlockDialog.getByRole("button", { name: "Unlock site" }).click();
    await siteCUnlockDialog.waitFor({ state: "hidden", timeout: 5000 });
    check("SHEET_LIVE: unlocking Site C still works too", (await siteCRow.getByText("Locked").count()) === 0);

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
    await db.site
      .updateMany({ where: { id: { in: [siteA!.id, siteB!.id, siteC!.id] } }, data: { isLocked: false, lockedAt: null, lockedById: null } })
      .catch(() => {});
    await db.siteItem
      .updateMany({ where: { siteId: { in: [siteA!.id, siteB!.id, siteC!.id] } }, data: { lockedRate: null, rateOverride: null } })
      .catch(() => {});
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
