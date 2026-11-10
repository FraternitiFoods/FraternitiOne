import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Dashboard "New site" (admin-created sites) e2e. Run against a running
 * `pnpm dev`:  npx tsx scripts/tmp-e2e-dashboard-create-site.ts
 *
 * Uses throwaway users (never the real admin's password) and TMP E2E sites,
 * all deleted in `finally`. It creates and deletes real rows, so it refuses to
 * run if the DB host is listed in E2E_FORBIDDEN_DB_HOSTS (comma-separated).
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const FORBIDDEN_DB_HOSTS = (process.env.E2E_FORBIDDEN_DB_HOSTS ?? "").split(",").filter(Boolean); // e.g. the production Neon endpoint
const dbHost = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
if (FORBIDDEN_DB_HOSTS.some((h) => dbHost.includes(h))) {
  console.error(`Refusing to run: DATABASE_URL points at ${dbHost}, which is in E2E_FORBIDDEN_DB_HOSTS.`);
  process.exit(1);
}

const db = new PrismaClient();
const PASSWORD = "TmpE2eDash123!";
const ADMIN = "tmp-e2e-dash-admin@example.com";
const SALES = "tmp-e2e-dash-sales@example.com";
const FRANCHISEE = "tmp-e2e-dash-franchisee@example.com";
const SITE_A = "TMP E2E Site A";
const SITE_B = "TMP E2E Site B";
const EMAILS = [ADMIN, SALES, FRANCHISEE];

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(cond ? "OK  " : "FAIL", "-", label, cond || !detail ? "" : `(${detail})`);
  if (!cond) failures++;
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

/** Playwright's isVisible() never waits, so use this for "should appear soon". */
async function appears(page: Page, locator: ReturnType<Page["locator"]>, ms = 10000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 8000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

async function cleanup() {
  const sites = await db.dashboardSite.findMany({ where: { name: { startsWith: "TMP E2E" } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { OR: [{ actorEmail: { in: EMAILS } }, { entityId: { in: sites.map((s) => s.id) } }] } });
  await db.dashboardSite.deleteMany({ where: { name: { startsWith: "TMP E2E" } } }); // steps cascade
  await db.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function createUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const [email, role] of [
    [ADMIN, "ADMIN"],
    [SALES, "SALES"],
    [FRANCHISEE, "FRANCHISEE"],
  ] as const) {
    await db.user.create({ data: { email, name: `Tmp ${role}`, role, passwordHash, isActive: true } });
  }
}

async function adminFlow(page: Page) {
  const template = JSON.parse(readFileSync(path.join(process.cwd(), "prisma/seed-data/dashboard-steps.json"), "utf8")) as {
    stages: { tasks: string[] }[];
  };
  const templateTotal = template.stages.reduce((n, s) => n + s.tasks.length, 0);
  check("template JSON has 402 tasks", templateTotal === 402, String(templateTotal));

  await login(page, ADMIN);
  await page.goto(`${BASE}/dashboard`);
  check("admin sees New site button", await page.getByRole("button", { name: "New site" }).isVisible());

  // ---- create A with only a name ----
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(`  ${SITE_A}  `);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Create site" }).click();
  await page.waitForURL(`**/dashboard/${encodeURIComponent(SITE_A)}`, { timeout: 20000 });
  const createMs = Date.now() - t0;
  console.log(`     create-site round trip: ${createMs} ms`);
  // Informational: dominated by DB round-trips (~150-200 ms each from a dev machine to Neon Singapore) + dev-mode compile on the first hit.
  check("create (action + redirect + new page) finishes in <15s", createMs < 15000, `${createMs}ms`);

  const a = await db.dashboardSite.findUnique({ where: { name: SITE_A }, include: { steps: true } });
  check("site A exists with origin WEBSITE", a?.origin === "WEBSITE");
  check("site A has all template steps", a?.steps.length === templateTotal, `${a?.steps.length}/${templateTotal}`);
  check("site A has 402 leaf steps, all NOT_STARTED", a?.steps.filter((s) => !s.isParent && s.status === "NOT_STARTED").length === 402);
  check("every step assigned to Admin", a?.steps.every((s) => s.assignedTo === "Admin") === true);
  check("parents have no status", a?.steps.filter((s) => s.isParent).every((s) => s.status === null) === true);
  check("site A is not marked synced", a?.lastSyncedAt === null && a?.lastSeenRunId === null);
  check("site page shows 'Not synced with sheet'", await page.getByText("Not synced with sheet").first().isVisible());
  check("site page shows 0%", await page.getByText("0%", { exact: true }).first().isVisible());
  check("audit CREATE event written", (await db.auditEvent.count({ where: { entityType: "DashboardSite", entityId: a?.id, action: "CREATE" } })) === 1);

  // ---- duplicate (different case / spacing) rejected ----
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill("tmp  e2e SITE a");
  await page.getByRole("button", { name: "Create site" }).click();
  check("duplicate name shows an error", await appears(page, page.getByText("A site with this name already exists.")));
  check("duplicate did not create a row", (await db.dashboardSite.count({ where: { name: { startsWith: "TMP E2E" } } })) === 1);
  await page.keyboard.press("Escape");

  // ---- bad URL rejected; good URL + dept text accepted ----
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(SITE_B);
  await page.getByLabel(/Drive folder link/).fill("https://drive.google.com/drive/folders/abc123");
  await page.getByLabel(/Department links/).fill("interiors --> https://example.com/interiors\nlegal --> https://example.com/legal");
  await page.getByRole("button", { name: "Create site" }).click();
  await page.waitForURL(`**/dashboard/${encodeURIComponent(SITE_B)}`, { timeout: 20000 });
  check("Drive folder link rendered", (await page.getByRole("link", { name: /Drive folder/ }).getAttribute("href")) === "https://drive.google.com/drive/folders/abc123");
  check("dept links rendered as links", (await page.locator('a[href="https://example.com/interiors"]').count()) === 1 && (await page.locator('a[href="https://example.com/legal"]').count()) === 1);

  // ---- edit details ----
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Department links").fill("accounts --> https://example.com/accounts");
  await page.getByRole("button", { name: "Save changes" }).click();
  check("edited dept links render", await appears(page, page.locator('a[href="https://example.com/accounts"]')));
  check("old dept link gone after edit", (await page.locator('a[href="https://example.com/interiors"]').count()) === 0);

  // ---- ranking badge ----
  await page.goto(`${BASE}/dashboard`);
  check("ranking shows 'Not synced with sheet' badges", (await page.getByText("Not synced with sheet").count()) >= 2);

  // ---- step status edit (optimistic + persisted + % updates) ----
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}/1`);
  const select = page.locator('select[aria-label^="Status of"]').first();
  const t1 = Date.now();
  await select.selectOption("COMPLETED");
  const optimisticMs = Date.now() - t1;
  const saved = await waitFor(async () => (await db.dashboardStep.count({ where: { site: { name: SITE_A }, status: "COMPLETED" } })) === 1);
  console.log(`     UI update ${optimisticMs} ms, persisted after ${Date.now() - t1} ms`);
  check("status change persisted to DB", Boolean(saved));
  check("status audit event written", (await db.auditEvent.count({ where: { entityType: "DashboardStep", action: "UPDATE", actorEmail: ADMIN } })) >= 1);
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}`);
  check("site page counts the completed step", await appears(page, page.getByText("1 completed")));

  // ---- remark edit ----
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}/1`);
  const remarkBox = page.locator('input[aria-label^="Remark for"]').first();
  await remarkBox.fill("e2e remark");
  await remarkBox.blur();
  check("remark persisted", Boolean(await waitFor(async () => (await db.dashboardStep.count({ where: { site: { name: SITE_A }, remark: "e2e remark" } })) === 1)));
}

async function otherRolesFlow(page: Page) {
  await login(page, SALES);
  await page.goto(`${BASE}/dashboard`);
  check("non-admin has no New site button", (await page.getByRole("button", { name: "New site" }).count()) === 0);
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}`);
  check("non-admin can view the site", await page.getByText("Not synced with sheet").first().isVisible());
  check("non-admin has no Edit details", (await page.getByRole("button", { name: "Edit details" }).count()) === 0);
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}/1`);
  check("non-admin sees no step editors", (await page.locator('select[aria-label^="Status of"]').count()) === 0);
}

async function franchiseeFlow(page: Page) {
  await login(page, FRANCHISEE);
  const res = await page.goto(`${BASE}/dashboard/${encodeURIComponent(SITE_A)}`);
  await page.waitForLoadState("networkidle");
  // The status code can be 200 when the route streams behind (app)/loading.tsx (pre-existing); what matters is that no site data is rendered.
  const body = (await page.locator("body").innerText()).toLowerCase();
  check("unassigned franchisee sees no site data", !body.includes("overall progress") && !body.includes("not synced with sheet"));
  check("unassigned franchisee sees a 403/forbidden page", res?.status() === 403 || body.includes("403") || body.includes("forbidden"), `status ${res?.status()}`);
}

/**
 * Sync must leave website sites alone. A real sync archives every sheet site
 * missing from its payload, so this only runs on a DB with no sheet-synced
 * sites (e.g. a fresh local Postgres) — never on the preview copy of prod.
 */
async function syncGuardCheck() {
  const secret = process.env.DASHBOARD_SYNC_SECRET;
  if (!secret) return console.log("SKIP - sync guard check (DASHBOARD_SYNC_SECRET not set)");
  if ((await db.dashboardSite.count({ where: { origin: "SHEET" } })) > 0) {
    return console.log("SKIP - sync guard check (DB has sheet-synced sites; a sync would archive them)");
  }
  const before = await db.dashboardSite.findUnique({ where: { name: SITE_A }, include: { _count: { select: { steps: true } } } });
  const call = async (p: string, body: unknown) => {
    const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const start = await call("/api/dashboard-sync/start", { requestId: null, trigger: "button", sheetName: "e2e", sheetId: "e2e", siteCount: 1, deptLinks: [] });
  const runId = start.json.runId as string;
  const collide = {
    name: "tmp e2e  site A",
    sortOrder: 0,
    stages: [{ stageNo: 1, stageName: "S1", steps: [{ stepKey: "2", label: "from sheet", sortOrder: 1, isParent: false, status: "Completed", shared: false, deliverables: [] }] }],
  };
  await call("/api/dashboard-sync/chunk", { runId, site: collide });
  const finish = await call("/api/dashboard-sync/finish", { runId, expected: { sites: 1 } });
  const after = await db.dashboardSite.findUnique({ where: { name: SITE_A }, include: { _count: { select: { steps: true } } } });
  check("sync finished OK", finish.ok);
  check("sync left the website site's steps untouched", before?._count.steps === after?._count.steps && after?.origin === "WEBSITE");
  check("sync did not create a duplicate site", (await db.dashboardSite.count({ where: { name: { equals: "tmp e2e site a", mode: "insensitive" } } })) === 1);
  check("sync reported a skip warning", JSON.stringify(finish.json).includes("created on the website"));
}

async function main() {
  console.log(`DB host: ${dbHost}\nApp: ${BASE}`);
  await cleanup();
  await createUsers();
  const browser = await chromium.launch();
  try {
    for (const flow of [adminFlow, otherRolesFlow, franchiseeFlow]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await flow(page);
      await ctx.close();
    }
    await syncGuardCheck();
  } finally {
    await browser.close();
    await cleanup();
    await db.$disconnect();
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
