import "dotenv/config";
import { createThrowawayAdmin, deleteThrowawayAdmin, THROWAWAY_ADMIN_PASSWORD } from "./lib/throwaway-admin";
import { seedBoqFixture, removeBoqFixture, countBoqFixtureLeftovers, readSetting, restoreSetting } from "./lib/boq-fixture";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Milestone M5 (plan.md section 1 "modes", section 4 editing UI, section 5
 * "Roles") smoke check — role/mode/Site-lock enforcement and the edit UI
 * built on top of it. Run with `npx tsx scripts/tmp-e2e-m5-site-boq-edit.ts`
 * against a running `pnpm dev`. Seeds the throwaway fixture from
 * scripts/lib/boq-fixture.ts (same one as the M3/M5/M6 scripts) and removes it
 * in `finally`; the `mode` setting is restored to whatever it was.
 *
 * Covers: mode is read-only everywhere except vendor/settings in SHEET_LIVE;
 * the mode switch + its confirmation dialog; qty/remark/tracking become
 * editable for every internal role once WEBSITE_LIVE; item/vendor/site
 * management stay Admin-only; a locked site freezes edits even for Admin;
 * edits write an audit event visible in Settings. Unit tests for the
 * underlying pure role/mode functions live in src/lib/permissions.test.ts
 * and src/lib/site-boq-write-guard.test.ts.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const ADMIN_EMAIL = "tmp-e2e-m5-edit-admin@example.com"; // throwaway ADMIN, deleted in `finally` (not the real admin: its password is rotated)

const SALES_EMAIL = "tmp-e2e-m5-sales@example.com";
const SALES_PASSWORD = "TmpE2eM5Test123!";

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

async function main() {
  const originalMode = await readSetting(db, "mode"); // put back exactly as found in `finally`
  await createThrowawayAdmin(db, ADMIN_EMAIL);
  await db.user.deleteMany({ where: { email: SALES_EMAIL } });
  const passwordHash = await bcrypt.hash(SALES_PASSWORD, 12);
  await db.user.create({ data: { name: "Tmp E2E M5 Project Manager", email: SALES_EMAIL, role: "PROJECT_MANAGER", passwordHash } });

  await setMode("SHEET_LIVE"); // the first half of this script checks the read-only mode
  await seedBoqFixture(db);

  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } });
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  if (!siteA || !kitchenSmallware) {
    throw new Error("Fixture data not found after seedBoqFixture() — check scripts/lib/boq-fixture.ts.");
  }
  const itemsUrl = `${BASE}/site-boq/items?site=${siteA.id}&category=${kitchenSmallware.id}`;

  const browser: Browser = await chromium.launch();

  try {
    const adminPage = await browser.newPage();
    await login(adminPage, ADMIN_EMAIL, THROWAWAY_ADMIN_PASSWORD);

    // ---- SHEET_LIVE: read-only everywhere except vendor contact details and settings (plan.md section 1). ----
    await adminPage.goto(itemsUrl);
    check("SHEET_LIVE: Items & Qty shows the read-only banner", (await adminPage.locator("body").innerText()).includes("Editing is disabled"));
    check("SHEET_LIVE: no qty input is rendered (read-only, not just disabled)", (await adminPage.locator('input[name="qty"]').count()) === 0);
    check("SHEET_LIVE: no 'Add item' button (item management is gated by mode)", (await adminPage.getByRole("button", { name: "Add item" }).count()) === 0);

    await adminPage.goto(`${BASE}/site-boq/vendors`);
    check(
      "SHEET_LIVE: vendor contact details ARE editable (mode-exempt)",
      (await adminPage.getByRole("button", { name: "Edit" }).count()) > 0
    );

    await adminPage.goto(`${BASE}/site-boq/sites`);
    check("SHEET_LIVE: no 'Add site' button (sites are gated by mode, unlike vendors)", (await adminPage.getByRole("button", { name: "Add site" }).count()) === 0);

    await adminPage.goto(`${BASE}/site-boq/settings`);
    let settingsText = await adminPage.locator("body").innerText();
    check("SHEET_LIVE: mode badge shows SHEET_LIVE", settingsText.includes("SHEET_LIVE"));
    check("Settings: Admin sees the mode switch button", (await adminPage.getByRole("button", { name: /Switch to Website live/i }).count()) === 1);
    check(
      "SHEET_LIVE: the settings form IS editable (settings is mode-exempt)",
      (await adminPage.locator('input[name="companyName"]').count()) === 1
    );
    check("Settings: Admin sees the audit log section", settingsText.includes("Recent edits"));

    // ---- Flip to WEBSITE_LIVE via the real confirmation-dialog flow. ----
    await adminPage.getByRole("button", { name: /Switch to Website live/i }).click();
    const modeDialog = adminPage.getByRole("dialog");
    const dialogText = await modeDialog.innerText();
    check("Mode switch dialog explains that editing turns on", dialogText.includes("Editing turns on"));
    await modeDialog.getByRole("button", { name: /^Switch to Website live$/ }).click();
    // Wait for the dialog itself to close (only happens once state.success flips
    // true after the action resolves) rather than racing `networkidle`, which
    // can settle in a quiet gap before the mutation's own fetch even starts.
    await modeDialog.waitFor({ state: "hidden", timeout: 20000 });
    settingsText = await adminPage.locator("body").innerText();
    check("After confirming, mode badge shows WEBSITE_LIVE", settingsText.includes("WEBSITE_LIVE"));

    // ---- WEBSITE_LIVE + Admin: qty/remark/tracking and item/vendor/site management are all editable. ----
    await adminPage.goto(itemsUrl);
    const bodyText = await adminPage.locator("body").innerText();
    check("WEBSITE_LIVE: the read-only banner is gone", !bodyText.includes("Editing is disabled"));
    const qtyInput = adminPage.locator("tr", { hasText: "GN Pan FIXTURE" }).locator('input[name="qty"]');
    check("WEBSITE_LIVE: a qty input is now rendered", (await qtyInput.count()) === 1);
    await qtyInput.fill("15");
    await qtyInput.press("Tab");
    await adminPage.waitForLoadState("networkidle");
    await adminPage.reload();
    check(
      "Qty edit persisted after reload",
      (await adminPage.locator("tr", { hasText: "GN Pan FIXTURE" }).locator('input[name="qty"]').inputValue()) === "15"
    );

    const gnPanRow = adminPage.locator("tr", { hasText: "GN Pan FIXTURE" });
    await gnPanRow.getByRole("button", { name: "Tracking" }).click();
    const trackingDialog = adminPage.getByRole("dialog", { name: /Order tracking/i });
    const stageInput = trackingDialog.locator("#stage");
    check("Tracking drawer: Stage field is editable in WEBSITE_LIVE", await stageInput.isEnabled());
    await stageInput.fill("Testing-M5");
    // The tracking form is the drawer's 2nd <form> — the 1st is the rate-override form added for Site lock (plan.md section 3/5) — both have a "Save" button.
    await trackingDialog.locator("form").last().getByRole("button", { name: "Save" }).click();
    await adminPage.waitForLoadState("networkidle");
    await trackingDialog.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
    check("Tracking drawer closed after a successful save", !(await trackingDialog.isVisible().catch(() => false)));

    check("WEBSITE_LIVE: 'Add item' button is visible for Admin", (await adminPage.getByRole("button", { name: "Add item" }).count()) === 1);

    await adminPage.goto(`${BASE}/site-boq/sites`);
    check("WEBSITE_LIVE: 'Add site' button is visible for Admin", (await adminPage.getByRole("button", { name: "Add site" }).count()) === 1);
    check("WEBSITE_LIVE: per-site 'Hide' button is visible for Admin", (await adminPage.getByRole("button", { name: "Hide" }).count()) > 0);

    // ---- Audit log recorded the edits above. ----
    await adminPage.goto(`${BASE}/site-boq/settings`);
    const auditText = await adminPage.locator("body").innerText();
    check("Audit log shows the qty edit", auditText.includes("Qty edited on"));
    check("Audit log shows the tracking-fields edit", auditText.includes("Tracking fields edited on"));

    await adminPage.close();

    // ---- A non-Admin role that can edit Site BOQ (PROJECT_MANAGER, plan.md section 12): qty/tracking yes, item/vendor/site/settings management no. ----
    const salesPage = await browser.newPage();
    await login(salesPage, SALES_EMAIL, SALES_PASSWORD);

    await salesPage.goto(itemsUrl);
    check("PROJECT_MANAGER role: qty input is still editable (role allows qty/remark/tracking)", (await salesPage.locator('input[name="qty"]').count()) > 0);
    check("PROJECT_MANAGER role: no 'Add item' button (item management is Admin-only)", (await salesPage.getByRole("button", { name: "Add item" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/vendors`);
    check("PROJECT_MANAGER role: no vendor 'Edit' button (vendor management is Admin-only)", (await salesPage.getByRole("button", { name: "Edit" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/sites`);
    check("PROJECT_MANAGER role: no 'Add site' button (site management is Admin-only)", (await salesPage.getByRole("button", { name: "Add site" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/settings`);
    const salesSettingsText = await salesPage.locator("body").innerText();
    check("PROJECT_MANAGER role: no mode-switch button on Settings", (await salesPage.getByRole("button", { name: /Switch to/i }).count()) === 0);
    check("PROJECT_MANAGER role: settings fields are read-only, not a form", (await salesPage.locator('input[name="companyName"]').count()) === 0);
    check("PROJECT_MANAGER role: no audit log section (Admin only)", !salesSettingsText.includes("Recent edits"));

    await salesPage.close();

    // ---- Site lock (plan.md sections 3 & 5): freezes edits for every role, Admin included, until unlocked. ----
    const admin = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
    await db.site.update({ where: { id: siteA.id }, data: { isLocked: true, lockedAt: new Date(), lockedById: admin!.id } });

    const adminPage2 = await browser.newPage();
    await login(adminPage2, ADMIN_EMAIL, THROWAWAY_ADMIN_PASSWORD);
    await adminPage2.goto(itemsUrl);
    const lockedBodyText = await adminPage2.locator("body").innerText();
    check("Locked site: lock banner shown on Items & Qty", lockedBodyText.includes("is locked"));
    check(
      "Locked site: qty is read-only even for Admin in WEBSITE_LIVE",
      (await adminPage2.locator('input[name="qty"]').count()) === 0
    );
    await adminPage2.close();

    await db.site.update({ where: { id: siteA.id }, data: { isLocked: false, lockedAt: null, lockedById: null } });
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await removeBoqFixture(db, { actorEmails: [ADMIN_EMAIL, SALES_EMAIL] }).catch((e) => {
      console.error("Failed to remove the fixture:", e);
      failures++;
    });
    await restoreSetting(db, "mode", originalMode).catch((e) => {
      console.error("Failed to restore mode:", e);
      failures++;
    });
    await db.user.deleteMany({ where: { email: SALES_EMAIL } }).catch((e) => {
      console.error("Failed to delete throwaway PROJECT_MANAGER user:", e);
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
