import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * CI smoke suite — run in `.github/workflows/ci.yml`'s `e2e` job against a
 * throwaway Postgres service container + `pnpm dev`, never against the real
 * dev DB. Rewritten for the `new` branch baseline (plan.md milestone M0):
 * everything the old suite covered (task creation, sales import, project
 * isolation, ...) belonged to modules removed on this branch. Covers what
 * actually exists now — login, landing on /site-boq, the internal-only 403
 * gate, and (milestone M2) the import API's auth/mode gating and
 * transactional guarantees — and should grow alongside Site BOQ's own
 * milestones rather than being rewritten wholesale again.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");
const IMPORT_SECRET = process.env.IMPORT_SECRET!;
if (!IMPORT_SECRET) throw new Error("IMPORT_SECRET not set");

const FRANCHISEE_EMAIL = "ci-smoke-franchisee@example.com";
const THROWAWAY_PASSWORD = "CiSmokeTest123!";

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

async function callImportApi(path: string, secret: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/**
 * Milestone M2 (plan.md section 7): bearer secret + mode gating, and the
 * transactional guarantees the import endpoints promise ("pushing the
 * fixture twice gives identical data"; "a failed chunk leaves old data
 * untouched"). Uses its own CI-SMOKE-IMPORT-* sourceKeys so it can't collide
 * with the main fixture in scripts/fixtures/boq-import-fixture.json, and
 * cleans up everything it creates.
 */
async function importApiChecks() {
  const prefix = "CI-SMOKE-IMPORT-";

  // ---- 401: wrong or missing bearer secret (checked before mode, so an
  // unauthenticated caller never learns the current mode). ----
  const wrongSecret = await callImportApi("/api/import/boq/begin", "not-the-real-secret", { dryRun: false });
  check("wrong import secret gives 401", wrongSecret.status === 401);

  const noAuthRes = await fetch(`${BASE}/api/import/boq/begin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: false }),
  });
  check("missing import secret gives 401", noAuthRes.status === 401);

  // ---- 403: mode = WEBSITE_LIVE (always restore SHEET_LIVE afterward, even on failure). ----
  await db.appSetting.upsert({
    where: { key: "mode" },
    update: { value: "WEBSITE_LIVE" },
    create: { key: "mode", value: "WEBSITE_LIVE" },
  });
  try {
    const gated = await callImportApi("/api/import/boq/begin", IMPORT_SECRET, { dryRun: false });
    check("import begin gives 403 when mode = WEBSITE_LIVE", gated.status === 403);
  } finally {
    await db.appSetting.update({ where: { key: "mode" }, data: { value: "SHEET_LIVE" } });
  }

  // ---- Idempotent repush: same site pushed in two separate runs ends up identical. ----
  const site = { siteKey: `${prefix}SITE-1`, name: `${prefix}Site`, shortCode: "CI1", openingDate: null };
  async function pushSite() {
    const begin = await callImportApi("/api/import/boq/begin", IMPORT_SECRET, { dryRun: false });
    const runId = begin.json.runId as string;
    const chunk = await callImportApi("/api/import/boq/chunk", IMPORT_SECRET, {
      runId,
      type: "sites",
      data: [site],
    });
    if (chunk.status !== 200) throw new Error(`sites chunk failed: ${JSON.stringify(chunk.json)}`);
    const finish = await callImportApi("/api/import/boq/finish", IMPORT_SECRET, { runId });
    if (finish.status !== 200) throw new Error(`finish failed: ${JSON.stringify(finish.json)}`);
  }
  await pushSite();
  const afterFirst = await db.site.findUnique({ where: { sourceKey: site.siteKey } });
  await pushSite();
  const afterSecond = await db.site.findUnique({ where: { sourceKey: site.siteKey } });
  check(
    "pushing the same site twice gives identical data",
    !!afterFirst &&
      !!afterSecond &&
      afterFirst.id === afterSecond.id &&
      afterFirst.name === afterSecond.name &&
      afterFirst.shortCode === afterSecond.shortCode
  );

  // ---- A failed chunk leaves old data untouched: a later chunk's name
  // collision must roll back both its own writes and not touch an earlier,
  // already-committed chunk in the same run. ----
  const keyA = `${prefix}ROLLBACK-A`;
  const keyB = `${prefix}ROLLBACK-B`;
  const keyC = `${prefix}ROLLBACK-C`;
  const collideName = `${prefix}Collide Site`;
  await db.site.deleteMany({ where: { sourceKey: { in: [keyA, keyB, keyC] } } });

  const begin2 = await callImportApi("/api/import/boq/begin", IMPORT_SECRET, { dryRun: false });
  const runId2 = begin2.json.runId as string;

  const firstChunk = await callImportApi("/api/import/boq/chunk", IMPORT_SECRET, {
    runId: runId2,
    type: "sites",
    data: [{ siteKey: keyA, name: collideName, shortCode: null, openingDate: null }],
  });
  check("rollback setup: first chunk committed", firstChunk.status === 200);

  const secondChunk = await callImportApi("/api/import/boq/chunk", IMPORT_SECRET, {
    runId: runId2,
    type: "sites",
    data: [
      { siteKey: keyB, name: `${prefix}Unique Site`, shortCode: null, openingDate: null },
      { siteKey: keyC, name: collideName, shortCode: null, openingDate: null }, // collides with keyA's name
    ],
  });
  check("a chunk whose second entry collides on a unique name fails", secondChunk.status >= 400);

  const rowB = await db.site.findUnique({ where: { sourceKey: keyB } });
  check("the failed chunk's own (otherwise-valid) first write rolled back too", rowB === null);

  const rowA = await db.site.findUnique({ where: { sourceKey: keyA } });
  check("the earlier, already-committed chunk survived the later failure", !!rowA && rowA.name === collideName);

  await db.site.deleteMany({ where: { sourceKey: { in: [site.siteKey, keyA, keyB, keyC] } } });
  await db.importRun.delete({ where: { id: runId2 } }).catch(() => {});
}

async function main() {
  await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({
    data: { name: "CI Smoke Franchisee", email: FRANCHISEE_EMAIL, role: "FRANCHISEE", passwordHash },
  });

  const browser: Browser = await chromium.launch();

  try {
    // ---- Unauthenticated request is bounced to /login (proxy.ts). ----
    const anonPage = await browser.newPage();
    const anonResp = await anonPage.goto(`${BASE}/site-boq`);
    check("anonymous request to /site-boq redirects to /login", anonPage.url().includes("/login"));
    check("that redirect did not 5xx", (anonResp?.status() ?? 200) < 500);
    await anonPage.close();

    // ---- Admin logs in and lands on /site-boq (plan.md section 2). ----
    const adminPage = await browser.newPage();
    await login(adminPage, "tech@fraterniti.co.in", DEV_PASSWORD);
    check("admin login lands on /site-boq", adminPage.url().endsWith("/site-boq"));
    await adminPage.waitForSelector("text=Site BOQ", { timeout: 10000 });
    check("Site BOQ shell rendered", true);
    await adminPage.close();

    // ---- Franchisee (external role) gets 403 on /site-boq. ----
    const franchiseePage = await browser.newPage();
    await login(franchiseePage, FRANCHISEE_EMAIL, THROWAWAY_PASSWORD);
    const boqResp = await franchiseePage.goto(`${BASE}/site-boq`);
    check("franchisee hitting /site-boq gets 403", boqResp?.status() === 403);
    await franchiseePage.close();

    // ---- Import API (plan.md section 7, milestone M2). ----
    await importApiChecks();
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
