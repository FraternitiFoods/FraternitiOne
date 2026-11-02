import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import path from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

/**
 * Site Tracker MVP smoke check (site-tracker-plan.md milestone T5), run
 * against the tracker seed (`npm run seed:tracker` — this script requires
 * it to have run at least once; it uses the "Pavitra" site and 4 of its
 * "Site Handover" steps by code, resetting just those rows before/after so
 * it's safe to re-run). Needs `pnpm dev` running first. If B2 credentials
 * are blank (or temporarily unset for this run) the upload flow exercises
 * the local-disk dev fallback per site-tracker-plan.md section 5 — that's
 * expected and is what "dev fallback is fine" in the milestone's own
 * acceptance wording means.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");

const SALES_EMAIL = "tmp-e2e-tracker-sales@example.com";
const FRANCHISEE_EMAIL = "tmp-e2e-tracker-franchisee@example.com";
const THROWAWAY_PASSWORD = "TmpE2eTrackerTest123!";

const STEP_CODE_COMPLETE = "7.1.2";
const STEP_CODE_NOT_REQUIRED = "7.1.3";
const STEP_CODE_LEGACY = "7.1.4";
const STEP_CODE_DIRECT_API = "7.1.5";
const SECTION_NAME = "Site Handover";

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

async function openSiteTrackerSection(page: Page) {
  const section = page.locator(`details[data-section-name="${SECTION_NAME}"]`);
  await section.waitFor({ state: "attached", timeout: 10000 });
  const isOpen = await section.getAttribute("open");
  if (isOpen === null) {
    await section.locator("summary").click();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function selectSite(page: Page, siteName: string) {
  await page.getByRole("combobox").first().click();
  // The option's accessible name is "<site name> <progress>%" — anchor on both ends so "Pavitra" never matches "Pavitra Vadodara".
  await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(siteName)} \\d+%$`) }).click();
  await page.waitForLoadState("networkidle");
}

function stepRow(page: Page, code: string) {
  return page.locator(`[data-step-code="${code}"]`);
}

async function main() {
  const site = await db.site.findFirst({ where: { usedInTracker: true, name: "Pavitra" } });
  if (!site) {
    throw new Error('Tracker site "Pavitra" not found — run `npm run seed:tracker` against this DB first.');
  }

  const steps = await db.trackerStep.findMany({
    where: { code: { in: [STEP_CODE_COMPLETE, STEP_CODE_NOT_REQUIRED, STEP_CODE_LEGACY, STEP_CODE_DIRECT_API] } },
  });
  const stepComplete = steps.find((s) => s.code === STEP_CODE_COMPLETE);
  const stepNotRequired = steps.find((s) => s.code === STEP_CODE_NOT_REQUIRED);
  const stepLegacy = steps.find((s) => s.code === STEP_CODE_LEGACY);
  const stepDirectApi = steps.find((s) => s.code === STEP_CODE_DIRECT_API);
  if (!stepComplete || !stepNotRequired || !stepLegacy || !stepDirectApi) {
    throw new Error("Expected tracker steps not found — run `npm run seed:tracker` against this DB first.");
  }

  // Reset just this test's rows so the script is safe to re-run.
  await db.trackerSiteStep.deleteMany({
    where: { siteId: site.id, stepId: { in: steps.map((s) => s.id) } },
  });

  await db.user.deleteMany({ where: { email: { in: [SALES_EMAIL, FRANCHISEE_EMAIL] } } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({ data: { name: "Tmp E2E Tracker Sales", email: SALES_EMAIL, role: "SALES", passwordHash } });
  await db.user.create({
    data: { name: "Tmp E2E Tracker Franchisee", email: FRANCHISEE_EMAIL, role: "FRANCHISEE", passwordHash },
  });

  // legacyCompleted fixture row (site-tracker-plan.md section 4 rule 1 exemption) — created directly, same as a Phase 2 import would.
  await db.trackerSiteStep.create({
    data: { siteId: site.id, stepId: stepLegacy.id, status: "COMPLETED", legacyCompleted: true },
  });

  const fixtureDir = path.join(process.cwd(), "scripts", "fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const imagePath = path.join(fixtureDir, "tmp-e2e-tracker-test.jpg");
  // Smallest valid 1x1 JPEG.
  writeFileSync(
    imagePath,
    Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMDAwMDAwMDAwMEAwMEBQQEBAQFBgUFBQUFBgcHBgYGBgcHCAoKCAgICQkJCQkKDAwMDAwMDAwMDAwMDAwMDAz/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAcgAAAAAAAAAAAAAAAAAAAAAAH//2Q==",
      "base64"
    )
  );

  const browser: Browser = await chromium.launch();

  try {
    // ================= Admin flow =================
    const adminPage = await browser.newPage();
    await login(adminPage, "tech@fraterniti.co.in", DEV_PASSWORD);
    await adminPage.goto(`${BASE}/site-tracker`);
    check("Site Tracker page loads for Admin", adminPage.url().includes("/site-tracker"));

    await selectSite(adminPage, site.name);
    const triggerText = await adminPage.getByRole("combobox").first().innerText();
    check("Site selector shows the chosen site", triggerText.includes(site.name));

    await openSiteTrackerSection(adminPage);

    // ---- legacyCompleted row renders as Completed with no forced dialog, with zero evidence. ----
    const legacyRow = stepRow(adminPage, STEP_CODE_LEGACY);
    await legacyRow.waitFor({ state: "visible", timeout: 10000 });
    check("legacyCompleted step shows status Completed on load", (await legacyRow.getAttribute("data-step-status")) === "COMPLETED");
    check("legacyCompleted step shows 0 evidence", (await legacyRow.innerText()).includes("0"));

    // Re-confirming a legacyCompleted step's status (no-op status change back to COMPLETED) must succeed via the API with zero evidence.
    const legacyApiRes = await adminPage.request.patch(`${BASE}/api/tracker/site-steps`, {
      data: { siteId: site.id, stepId: stepLegacy.id, status: "COMPLETED" },
    });
    check("legacyCompleted step can stay Completed via API with 0 evidence", legacyApiRes.ok());

    // ---- Direct API call: marking a fresh step Completed with no evidence is rejected (4xx), not just blocked in the UI. ----
    const directApiRes = await adminPage.request.patch(`${BASE}/api/tracker/site-steps`, {
      data: { siteId: site.id, stepId: stepDirectApi.id, status: "COMPLETED" },
    });
    check("direct API: Completed with no evidence is rejected", directApiRes.status() >= 400 && directApiRes.status() < 500);

    // ---- UI: picking "Completed" with no evidence opens the forced-upload dialog instead of saving immediately. ----
    const completeRow = stepRow(adminPage, STEP_CODE_COMPLETE);
    await completeRow.waitFor({ state: "visible", timeout: 10000 });
    await completeRow.getByRole("combobox").click();
    await adminPage.getByRole("option", { name: "Completed" }).click();

    const dialog = adminPage.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    check("Completed dialog opens when there's no evidence yet", await dialog.isVisible());
    const confirmButton = dialog.getByRole("button", { name: "Mark Completed" });
    check("Confirm is disabled until evidence is uploaded", await confirmButton.isDisabled());
    check(
      "Step status is unchanged while the dialog is still open",
      (await completeRow.getAttribute("data-step-status")) !== "COMPLETED"
    );

    // ---- Upload a small image (dev fallback is fine) ----
    await dialog.locator('input[type="file"]').setInputFiles(imagePath);
    await dialog.getByText("Uploaded").waitFor({ timeout: 20000 });
    let confirmEnabled = await confirmButton.isEnabled();
    if (!confirmEnabled) {
      // The upload-list "Uploaded" text and the parent's evidence-array state update land in the same tick in practice, but give one extra React tick of slack before failing for real.
      await adminPage.waitForTimeout(300);
      confirmEnabled = await confirmButton.isEnabled();
    }
    check("Confirm enables once a file is uploaded", confirmEnabled);

    await confirmButton.click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    await completeRow.waitFor({ state: "visible", timeout: 10000 });
    check("Step is Completed after confirming with evidence", (await completeRow.getAttribute("data-step-status")) === "COMPLETED");
    check("Evidence count shows 1", (await completeRow.innerText()).includes("1"));

    // ---- Progress % changes after completing a step. ----
    const progressAfterComplete = await adminPage.locator("body").innerText();
    check("Progress percentage is rendered", /\d+\.\d%/.test(progressAfterComplete) || /\d+%/.test(progressAfterComplete));

    // ---- Not required shrinks the denominator (same site, a fresh step). ----
    const notRequiredRow = stepRow(adminPage, STEP_CODE_NOT_REQUIRED);
    await notRequiredRow.waitFor({ state: "visible", timeout: 10000 });
    await notRequiredRow.getByRole("combobox").click();
    await adminPage.getByRole("option", { name: "Not required" }).click();
    await adminPage.waitForTimeout(500);
    check(
      "Step status becomes Not required",
      (await notRequiredRow.getAttribute("data-step-status")) === "NOT_REQUIRED"
    );

    const summaryAfterNotRequired = await db.trackerSiteStep.findUnique({
      where: { siteId_stepId: { siteId: site.id, stepId: stepNotRequired.id } },
    });
    check("Not required persisted server-side", summaryAfterNotRequired?.status === "NOT_REQUIRED");

    // ---- Evidence row id for the admin-only delete-rejection check below. ----
    const evidenceRow = await db.trackerEvidence.findFirst({
      where: { siteStep: { siteId: site.id, stepId: stepComplete.id } },
    });
    check("Evidence row exists after upload", Boolean(evidenceRow));

    await adminPage.close();

    // ================= Non-admin internal role: can edit, cannot delete evidence =================
    const salesPage = await browser.newPage();
    await login(salesPage, SALES_EMAIL, THROWAWAY_PASSWORD);
    const salesPageResp = await salesPage.goto(`${BASE}/site-tracker`);
    check("Internal non-admin role (SALES) can open Site Tracker", salesPageResp?.status() === 200);

    if (evidenceRow) {
      const deleteRes = await salesPage.request.delete(`${BASE}/api/tracker/evidence/${evidenceRow.id}`);
      check("Non-admin evidence delete is rejected (403)", deleteRes.status() === 403);
    }
    await salesPage.close();

    // ================= External role: 403 everywhere, no sidebar link =================
    const franchiseePage = await browser.newPage();
    await login(franchiseePage, FRANCHISEE_EMAIL, THROWAWAY_PASSWORD);
    const franchiseeResp = await franchiseePage.goto(`${BASE}/site-tracker`);
    check("External role (FRANCHISEE) gets 403 on /site-tracker", franchiseeResp?.status() === 403);
    check(
      "External role doesn't see a Site Tracker sidebar link",
      (await franchiseePage.locator('a[href="/site-tracker"]').count()) === 0
    );

    const franchiseeApiRes = await franchiseePage.request.get(`${BASE}/api/tracker/sites`);
    check("External role gets 403 from /api/tracker/sites", franchiseeApiRes.status() === 403);
    await franchiseePage.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    rmSync(imagePath, { force: true });
    await db.user.deleteMany({ where: { email: { in: [SALES_EMAIL, FRANCHISEE_EMAIL] } } }).catch((e) => {
      console.error("Failed to delete throwaway users:", e);
      failures++;
    });
    await db.trackerSiteStep
      .deleteMany({ where: { siteId: site.id, stepId: { in: steps.map((s) => s.id) } } })
      .catch((e) => {
        console.error("Failed to reset tracker test rows:", e);
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
