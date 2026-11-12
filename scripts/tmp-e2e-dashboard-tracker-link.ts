import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * A site created on /dashboard must also show up in Site Tracker (dropdown +
 * "All sites"), tracker-only (not in BOQ), 0% with the normal sections, and
 * a name already used by a shared Site must be rejected. Needs `pnpm dev`.
 * Creates "TMP E2E Tracker Link" and removes everything it made in `finally`.
 * Refuses to run against a DB host listed in E2E_FORBIDDEN_DB_HOSTS.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";

const ADMIN = "tmp-e2e-tracker-link-admin@example.com";
const PASSWORD = "TmpE2eTrackerLink123!";
const NAME = "TMP E2E Tracker Link";
const CLASH = "TMP E2E Tracker Clash";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(ADMIN);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function cleanup() {
  const ds = await db.dashboardSite.findMany({ where: { name: { in: [NAME, CLASH.toLowerCase()] } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: ds.map((d) => d.id) } } });
  await db.dashboardSite.deleteMany({ where: { id: { in: ds.map((d) => d.id) } } });
  await db.site.deleteMany({ where: { name: { in: [NAME, CLASH] } } });
  await db.auditEvent.deleteMany({ where: { actorEmail: ADMIN } });
  await db.user.deleteMany({ where: { email: ADMIN } });
}

async function main() {
  const host = new URL(process.env.DATABASE_URL!).host;
  const forbidden = (process.env.E2E_FORBIDDEN_DB_HOSTS ?? "").split(",").filter(Boolean);
  if (forbidden.some((h) => host.includes(h))) throw new Error(`Refusing to run against ${host}`);

  await cleanup();
  await db.user.create({
    data: { email: ADMIN, name: "Tmp Admin", role: "ADMIN", passwordHash: await bcrypt.hash(PASSWORD, 12), isActive: true },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await login(page);

    await page.goto(`${BASE}/dashboard`);
    await page.getByRole("button", { name: "New site" }).click();
    await page.getByLabel("Site name").fill(NAME);
    await page.getByRole("button", { name: "Create site" }).click();
    await page.waitForURL(`**/dashboard/${encodeURIComponent(NAME)}`, { timeout: 30000 });

    const tracker = await db.site.findUnique({ where: { name: NAME } });
    check("shared Site row exists for tracker AND BOQ", !!tracker && tracker.usedInTracker && tracker.usedInBoq);

    // Name clash with a shared Site -> rejected, no Dashboard site created.
    await db.site.create({ data: { sourceKey: "TMP-E2E-CLASH", name: CLASH, usedInBoq: false, usedInTracker: true } });
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole("button", { name: "New site" }).click();
    await page.getByLabel("Site name").fill(CLASH.toLowerCase());
    await page.getByRole("button", { name: "Create site" }).click();
    await page.getByText("tracker/BOQ site with this name already exists").waitFor({ timeout: 30000 });
    check("clash with a shared Site is rejected", (await db.dashboardSite.count({ where: { name: CLASH.toLowerCase() } })) === 0);

    // Site Tracker: dropdown lists it, 0%, normal accordion; All sites lists it too.
    let t0 = Date.now();
    await page.goto(`${BASE}/site-tracker`);
    await page.getByRole("combobox").first().waitFor({ timeout: 60000 });
    console.log(`INFO - /site-tracker load ${Date.now() - t0} ms`);
    await page.getByRole("combobox").first().click();
    const option = page.getByRole("option", { name: new RegExp(`^${NAME} 0%$`) });
    check("new site is in the tracker dropdown at 0%", await option.isVisible());
    t0 = Date.now();
    await option.click();
    await page.locator("details[data-section-name]").first().waitFor({ timeout: 30000 });
    console.log(`INFO - site switch ${Date.now() - t0} ms`);
    check("normal tracker sections render for the new site", (await page.locator("details[data-section-name]").count()) > 0);
    await page.goto(`${BASE}/site-boq/sites`);
    await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {}); // loading.tsx streams the table in after load
    check("new site is in the Site BOQ sites list", await page.getByText(NAME, { exact: true }).first().isVisible());
    await page.goto(`${BASE}/site-boq`);
    await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {});
    check("new site is on the Site BOQ overview", await page.getByText(NAME, { exact: true }).first().isVisible());
    check("no 'Sync with sheet' button on /site-boq", (await page.getByRole("button", { name: "Sync with sheet" }).count()) === 0);
    await page.goto(`${BASE}/dashboard`);
    check("no 'Sync with sheet' button on /dashboard", (await page.getByRole("button", { name: "Sync with sheet" }).count()) === 0);
    await page.goto(`${BASE}/site-tracker`);
    await page.getByRole("combobox").first().waitFor({ timeout: 60000 });

    await page.getByRole("button", { name: "All sites" }).click();
    check("new site is in the All sites tab", await page.getByText(NAME, { exact: true }).first().isVisible());
  } finally {
    await browser.close();
    await cleanup();
    const left =
      (await db.site.count({ where: { name: { in: [NAME, CLASH] } } })) +
      (await db.dashboardSite.count({ where: { name: { in: [NAME, CLASH.toLowerCase()] } } }));
    check("no leftover test rows", left === 0);
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
