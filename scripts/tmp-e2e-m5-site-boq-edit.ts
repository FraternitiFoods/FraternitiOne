import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Milestone M5 (plan.md section 1 "modes", section 4 editing UI, section 5
 * "Roles") smoke check — role/mode/Site-lock enforcement and the edit UI
 * built on top of it. Run with `npx tsx scripts/tmp-e2e-m5-site-boq-edit.ts`
 * against a running `pnpm dev`. Reuses `scripts/fixtures/boq-import-fixture.json`
 * (same fixture as the M3 script) — re-pushes it at the start AND the end so
 * this is self-sufficient regardless of what other scripts last touched the
 * dev DB (see tmp-e2e-m3-site-boq.ts's header for why that matters: `finish`
 * soft-deactivates any site/item not touched by the *latest* run).
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
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");
const IMPORT_SECRET = process.env.IMPORT_SECRET!;
if (!IMPORT_SECRET) throw new Error("IMPORT_SECRET not set");

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
  await db.user.deleteMany({ where: { email: SALES_EMAIL } });
  const passwordHash = await bcrypt.hash(SALES_PASSWORD, 12);
  await db.user.create({ data: { name: "Tmp E2E M5 Sales", email: SALES_EMAIL, role: "SALES", passwordHash } });

  // pushFixture requires SHEET_LIVE (the import endpoints 403 in WEBSITE_LIVE).
  await setMode("SHEET_LIVE");
  await pushFixture();

  const siteA = await db.site.findUnique({ where: { sourceKey: "S-FIX-001" } });
  const kitchenSmallware = await db.category.findUnique({ where: { name: "Kitchen Smallware" } });
  if (!siteA || !kitchenSmallware) {
    throw new Error("Fixture data not found after pushFixture() — check scripts/fixtures/boq-import-fixture.json.");
  }
  const itemsUrl = `${BASE}/site-boq/items?site=${siteA.id}&category=${kitchenSmallware.id}`;

  const browser: Browser = await chromium.launch();

  try {
    const adminPage = await browser.newPage();
    await login(adminPage, "tech@fraterniti.co.in", DEV_PASSWORD);

    // ---- SHEET_LIVE: read-only everywhere except vendor contact details and settings (plan.md section 1). ----
    await adminPage.goto(itemsUrl);
    check("SHEET_LIVE: Items & Qty shows the read-only banner", (await adminPage.locator("body").innerText()).includes("Sheet is live"));
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
    check("Mode switch dialog explains the import will 403", dialogText.includes("403"));
    await modeDialog.getByRole("button", { name: /^Switch to Website live$/ }).click();
    // Wait for the dialog itself to close (only happens once state.success flips
    // true after the action resolves) rather than racing `networkidle`, which
    // can settle in a quiet gap before the mutation's own fetch even starts.
    await modeDialog.waitFor({ state: "hidden", timeout: 5000 });
    settingsText = await adminPage.locator("body").innerText();
    check("After confirming, mode badge shows WEBSITE_LIVE", settingsText.includes("WEBSITE_LIVE"));

    // ---- import endpoints 403 once WEBSITE_LIVE (plan.md section 1 — the other half of the mode gate). ----
    const gatedBegin = await fetch(`${BASE}/api/import/boq/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${IMPORT_SECRET}` },
      body: JSON.stringify({ dryRun: false }),
    });
    check("WEBSITE_LIVE: import begin now returns 403", gatedBegin.status === 403);

    // ---- WEBSITE_LIVE + Admin: qty/remark/tracking and item/vendor/site management are all editable. ----
    await adminPage.goto(itemsUrl);
    const bodyText = await adminPage.locator("body").innerText();
    check("WEBSITE_LIVE: the read-only banner is gone", !bodyText.includes("Sheet is live"));
    const qtyInput = adminPage.locator('input[name="qty"]').first();
    check("WEBSITE_LIVE: a qty input is now rendered", (await qtyInput.count()) === 1);
    await qtyInput.fill("15");
    await qtyInput.press("Tab");
    await adminPage.waitForLoadState("networkidle");
    await adminPage.reload();
    check("Qty edit persisted after reload", (await adminPage.locator('input[name="qty"]').first().inputValue()) === "15");

    const gnPanRow = adminPage.locator("tr", { hasText: "GN Pan" });
    await gnPanRow.getByRole("button", { name: "Tracking" }).click();
    const trackingDialog = adminPage.getByRole("dialog", { name: /Order tracking/i });
    const stageInput = trackingDialog.locator("#stage");
    check("Tracking drawer: Stage field is editable in WEBSITE_LIVE", await stageInput.isEnabled());
    await stageInput.fill("Testing-M5");
    // The tracking form is the drawer's 2nd <form> — the 1st is the rate-override form added for Site lock (plan.md section 3/5) — both have a "Save" button.
    await trackingDialog.locator("form").last().getByRole("button", { name: "Save" }).click();
    await adminPage.waitForLoadState("networkidle");
    await trackingDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
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

    // ---- A non-Admin internal role (SALES): qty/tracking yes, item/vendor/site/settings management no. ----
    const salesPage = await browser.newPage();
    await login(salesPage, SALES_EMAIL, SALES_PASSWORD);

    await salesPage.goto(itemsUrl);
    check("SALES role: qty input is still editable (role allows qty/remark/tracking)", (await salesPage.locator('input[name="qty"]').count()) > 0);
    check("SALES role: no 'Add item' button (item management is Admin-only)", (await salesPage.getByRole("button", { name: "Add item" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/vendors`);
    check("SALES role: no vendor 'Edit' button (vendor management is Admin-only)", (await salesPage.getByRole("button", { name: "Edit" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/sites`);
    check("SALES role: no 'Add site' button (site management is Admin-only)", (await salesPage.getByRole("button", { name: "Add site" }).count()) === 0);

    await salesPage.goto(`${BASE}/site-boq/settings`);
    const salesSettingsText = await salesPage.locator("body").innerText();
    check("SALES role: no mode-switch button on Settings", (await salesPage.getByRole("button", { name: /Switch to/i }).count()) === 0);
    check("SALES role: settings fields are read-only, not a form", (await salesPage.locator('input[name="companyName"]').count()) === 0);
    check("SALES role: no audit log section (Admin only)", !salesSettingsText.includes("Recent edits"));

    await salesPage.close();

    // ---- Site lock (plan.md sections 3 & 5): freezes edits for every role, Admin included, until unlocked. ----
    const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
    await db.site.update({ where: { id: siteA.id }, data: { isLocked: true, lockedAt: new Date(), lockedById: admin!.id } });

    const adminPage2 = await browser.newPage();
    await login(adminPage2, "tech@fraterniti.co.in", DEV_PASSWORD);
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
    await setMode("SHEET_LIVE").catch((e) => {
      console.error("Failed to restore mode to SHEET_LIVE:", e);
      failures++;
    });
    await db.site
      .update({ where: { id: siteA!.id }, data: { isLocked: false, lockedAt: null, lockedById: null } })
      .catch(() => {});
    await pushFixture().catch((e) => {
      console.error("Failed to re-push the fixture during cleanup:", e);
      failures++;
    });
    await db.user.deleteMany({ where: { email: SALES_EMAIL } }).catch((e) => {
      console.error("Failed to delete throwaway SALES user:", e);
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
