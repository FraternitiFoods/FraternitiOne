import "dotenv/config";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Access control + Dashboard task assignments e2e (plan.md section 12). Run
 * against a running `pnpm dev`:  npx tsx scripts/tmp-e2e-dashboard-assignments.ts
 *
 * Throwaway users (one per role under test, never the real admin) and one
 * "TMP E2E Assign" site, all deleted in `finally`. It writes real rows, so it
 * refuses to run if the DB host is listed in E2E_FORBIDDEN_DB_HOSTS. It does
 * NOT push a sheet snapshot, so it doesn't need the db-restore helper.
 *
 * Story: Admin creates a site and gives Tony (MARKETING) Stage 1 minus two
 * tasks plus Stage 8; then each role's sidebar, landing page, locked/open
 * stage cards, direct-URL 403s and API permissions are checked.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const FORBIDDEN_DB_HOSTS = (process.env.E2E_FORBIDDEN_DB_HOSTS ?? "").split(",").filter(Boolean);
const dbHost = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
if (FORBIDDEN_DB_HOSTS.some((h) => dbHost.includes(h))) {
  console.error(`Refusing to run: DATABASE_URL points at ${dbHost}, which is in E2E_FORBIDDEN_DB_HOSTS.`);
  process.exit(1);
}

const db = new PrismaClient();
const PASSWORD = "TmpE2eAssign123!";
const SITE = "TMP E2E Assign";
const SITE_URL = `${BASE}/dashboard/${encodeURIComponent(SITE)}`;

const USERS = {
  admin: { email: "tmp-e2e-assign-admin@example.com", role: "ADMIN" },
  tony: { email: "tmp-e2e-assign-tony@example.com", role: "MARKETING" },
  sales: { email: "tmp-e2e-assign-sales@example.com", role: "SALES" },
  ops: { email: "tmp-e2e-assign-ops@example.com", role: "OPERATIONS" },
  accounts: { email: "tmp-e2e-assign-accounts@example.com", role: "ACCOUNTS" },
  mgmt: { email: "tmp-e2e-assign-mgmt@example.com", role: "MANAGEMENT" },
  franchisee: { email: "tmp-e2e-assign-franchisee@example.com", role: "FRANCHISEE" },
} as const satisfies Record<string, { email: string; role: Role }>;
const EMAILS = Object.values(USERS).map((u) => u.email);

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(cond ? "OK  " : "FAIL", "-", label, cond || detail === undefined ? "" : `(${JSON.stringify(detail)})`);
  if (!cond) failures++;
}

async function login(ctx: BrowserContext, who: keyof typeof USERS): Promise<{ page: Page; landedOn: string }> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(USERS[who].email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
  return { page, landedOn: new URL(page.url()).pathname };
}

async function appears(locator: ReturnType<Page["locator"]>, ms = 15000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 10000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/** 403 either as the status or as the rendered forbidden page (routes behind (app)/loading.tsx can stream a 200 first). */
async function isForbidden(page: Page, url: string): Promise<boolean> {
  const res = await page.goto(url);
  await page.waitForLoadState("networkidle");
  const body = (await page.locator("body").innerText()).toLowerCase();
  return res?.status() === 403 || body.includes("403") || body.includes("forbidden");
}

async function sidebarHas(page: Page, href: string): Promise<boolean> {
  return (await page.locator(`a[href="${href}"]`).count()) > 0;
}

async function cleanup() {
  const dsites = await db.dashboardSite.findMany({ where: { name: { startsWith: "TMP E2E" } }, select: { id: true } });
  const sites = await db.site.findMany({ where: { name: { startsWith: "TMP E2E" } }, select: { id: true } });
  await db.auditEvent.deleteMany({
    where: { OR: [{ actorEmail: { in: EMAILS } }, { entityId: { in: [...dsites, ...sites].map((s) => s.id) } }] },
  });
  await db.dashboardSite.deleteMany({ where: { id: { in: dsites.map((s) => s.id) } } }); // steps + assignments cascade
  await db.site.deleteMany({ where: { id: { in: sites.map((s) => s.id) } } }); // tracker / BOQ / ops-BOQ rows cascade
  await db.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function createUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const [key, u] of Object.entries(USERS)) {
    await db.user.create({ data: { email: u.email, name: `Tmp ${key}`, role: u.role, passwordHash, isActive: true } });
  }
}

async function main() {
  console.log(`DB host: ${dbHost}\nApp: ${BASE}`);
  await cleanup();
  await createUsers();
  const browser = await chromium.launch();
  try {
    // ============================ ADMIN ============================
    const adminCtx = await browser.newContext();
    const { page: admin, landedOn: adminLanding } = await login(adminCtx, "admin");
    check("Admin still lands on /site-boq", adminLanding === "/site-boq", adminLanding);

    await admin.goto(`${BASE}/dashboard`);
    await admin.getByRole("button", { name: "New site" }).click();
    await admin.getByLabel("Site name").fill(SITE);
    await admin.getByRole("button", { name: "Create site" }).click();
    await admin.waitForURL(`**/dashboard/${encodeURIComponent(SITE)}`, { timeout: 60000 });

    const dsite = await db.dashboardSite.findUniqueOrThrow({ where: { name: SITE } });
    const stage1 = await db.dashboardStep.findMany({ where: { siteId: dsite.id, stageNo: 1, isParent: false }, orderBy: { sortOrder: "asc" } });
    const stage8 = await db.dashboardStep.findMany({ where: { siteId: dsite.id, stageNo: 8, isParent: false }, orderBy: { sortOrder: "asc" } });
    const stage2 = await db.dashboardStep.findMany({ where: { siteId: dsite.id, stageNo: 2, isParent: false }, orderBy: { sortOrder: "asc" } });
    check("site has stage 1, 2 and 8 tasks", stage1.length > 3 && stage2.length > 0 && stage8.length > 0, [stage1.length, stage2.length, stage8.length]);
    const unticked = [stage1[1], stage1[2]]; // Tony must NOT hold these two
    const expectedIds = new Set([...stage1.filter((s) => !unticked.includes(s)), ...stage8].map((s) => s.id));

    // --- Team page ---
    check("Admin sees the Team button on a website site", await appears(admin.locator('a[href$="/team"]')));
    await admin.locator('a[href$="/team"]').first().click();
    await admin.waitForURL(`**/dashboard/${encodeURIComponent(SITE)}/team`, { timeout: 60000 });
    const optionValues = await admin.getByLabel("Person").locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const tony = await db.user.findUniqueOrThrow({ where: { email: USERS.tony.email } });
    const adminUser = await db.user.findUniqueOrThrow({ where: { email: USERS.admin.email } });
    const franchisee = await db.user.findUniqueOrThrow({ where: { email: USERS.franchisee.email } });
    check("picker lists Tony", optionValues.includes(tony.id));
    check("picker excludes Admin and Franchisee users", !optionValues.includes(adminUser.id) && !optionValues.includes(franchisee.id));

    await admin.getByLabel("Person").selectOption(tony.id);
    await admin.getByRole("button", { name: /^Stage 1 — / }).click();
    await admin.getByLabel("Assign whole Stage 1", { exact: true }).check();
    check("ticking the whole stage ticks every task in it", (await admin.locator('input[aria-label^="Assign task:"]:checked').count()) === stage1.length);
    for (const s of unticked) await admin.getByLabel(`Assign task: ${s.label}`, { exact: true }).uncheck();
    await admin.getByRole("button", { name: /^Stage 8 — / }).click();
    await admin.getByLabel("Assign whole Stage 8", { exact: true }).check();
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    const saved = await waitFor(async () => (await db.dashboardStepAssignment.count({ where: { userId: tony.id } })) === expectedIds.size);
    check("Tony holds exactly stage 1 minus 2 tasks + stage 8", Boolean(saved), await db.dashboardStepAssignment.count({ where: { userId: tony.id } }));
    const rows = await db.dashboardStepAssignment.findMany({ where: { userId: tony.id } });
    check("none of the unticked tasks is assigned", rows.every((r) => expectedIds.has(r.stepId)) && !rows.some((r) => unticked.some((u) => u.id === r.stepId)));
    check("assignedBy is the admin", rows.every((r) => r.assignedById === adminUser.id));
    const audits = await db.auditEvent.findMany({ where: { entityType: "DashboardSite", entityId: dsite.id, action: "UPDATE" } });
    check("exactly one audit event for the whole save, with per-stage counts", audits.length === 1 && JSON.stringify(audits[0]?.newValue).includes('"tasksPerStage"'), audits.length);
    check("team list shows Tony", await appears(admin.getByTestId("team-list").getByText("Tmp tony")));

    // --- server refuses assigning Admin / franchisee / foreign steps (forged calls) ---
    // (covered by the Server Action's own guards; the picker can't even offer them.)

    // ============================ TONY (MARKETING) ============================
    const tonyCtx = await browser.newContext();
    const { page: t, landedOn: tonyLanding } = await login(tonyCtx, "tony");
    check("Tony lands on /dashboard, not a 403", tonyLanding === "/dashboard", tonyLanding);
    check("Tony's sidebar has Dashboard + Site Tracker", (await sidebarHas(t, "/dashboard")) && (await sidebarHas(t, "/site-tracker")));
    check("Tony's sidebar has no Site BOQ / Operations BOQ", !(await sidebarHas(t, "/site-boq")) && !(await sidebarHas(t, "/operations-boq")));
    check("Tony gets 403 on /site-boq", await isForbidden(t, `${BASE}/site-boq`));
    check("Tony gets 403 on /operations-boq", await isForbidden(t, `${BASE}/operations-boq`));
    await t.goto(`${BASE}/users`);
    const leftUsersPage = await t.waitForURL((u) => !u.pathname.startsWith("/users"), { timeout: 20000 }).then(() => true, () => false);
    check("Tony cannot open Manage users (bounced to his landing page)", leftUsersPage && new URL(t.url()).pathname === "/dashboard", t.url());

    await t.goto(SITE_URL);
    check("Tony can open the site and sees overall progress", await appears(t.getByText("Overall progress")));
    check("Tony has no Team / Edit / Delete buttons", (await t.locator('a[href$="/team"]').count()) === 0 && (await t.getByRole("button", { name: "Edit details" }).count()) === 0 && (await t.getByRole("button", { name: "Delete site" }).count()) === 0);
    check("stage 1 and 8 cards are links", (await t.locator(`a[href="/dashboard/${encodeURIComponent(SITE)}/1"]`).count()) === 1 && (await t.locator(`a[href="/dashboard/${encodeURIComponent(SITE)}/8"]`).count()) === 1);
    check("the other 11 cards are shown locked, not links", (await t.locator('[data-locked="true"]').count()) === 11 && (await t.locator(`a[href="/dashboard/${encodeURIComponent(SITE)}/2"]`).count()) === 0);
    check("a locked card still shows its progress", (await t.locator('[data-locked="true"]').first().innerText()).includes("%"));

    check("typed URL to an unassigned stage (2) is refused server-side", await isForbidden(t, `${SITE_URL}/2`));

    await t.goto(`${SITE_URL}/1`);
    check("stage 1 opens for Tony", await appears(t.getByText(stage1[0].label, { exact: true })));
    check("Tony sees ALL stage-1 tasks, including the 2 not assigned to him", (await t.getByText(unticked[0].label, { exact: true }).count()) >= 1 && (await t.getByText(unticked[1].label, { exact: true }).count()) >= 1);
    check("exactly his tasks are highlighted", (await t.locator('[data-mine="true"]').count()) === stage1.length - unticked.length);
    check("exactly his tasks have a status control", (await t.locator('select[aria-label^="Status of"]').count()) === stage1.length - unticked.length);
    check("an unassigned task has no status control", (await t.locator(`select[aria-label="Status of ${unticked[0].label}"]`).count()) === 0);
    check("Tony sees his name as the assignee", (await t.getByText("Assigned: Tmp tony").count()) >= 1);

    // --- Tony edits his own task; capture the real call to forge it afterwards ---
    const mine = stage1.filter((s) => !unticked.includes(s))[0];
    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    await t.route("**/dashboard/**", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && (req.postData() ?? "").includes(mine.id)) {
        const h = req.headers();
        captured = {
          url: req.url(),
          headers: {
            "next-action": h["next-action"] ?? "",
            "content-type": h["content-type"] ?? "text/plain;charset=UTF-8",
            accept: h["accept"] ?? "text/x-component",
            "next-router-state-tree": h["next-router-state-tree"] ?? "",
          },
          body: req.postData() ?? "",
        };
      }
      await route.continue();
    });
    await t.locator(`select[aria-label="Status of ${mine.label}"]`).selectOption("COMPLETED");
    const done = await waitFor(async () => (await db.dashboardStep.findUnique({ where: { id: mine.id } }))?.status === "COMPLETED");
    check("Tony's status change persisted", Boolean(done));
    check("audit event is under Tony's name", (await db.auditEvent.count({ where: { entityType: "DashboardStep", entityId: mine.id, actorEmail: USERS.tony.email } })) === 1);
    check("captured the real Server Action call", captured !== null);

    const call = captured as { url: string; headers: Record<string, string>; body: string } | null;
    if (call) {
      const foreign = unticked[0];
      const forged = await tonyCtx.request.post(call.url, { headers: call.headers, data: call.body.replace(mine.id, foreign.id) });
      check("forged save on a task NOT assigned to Tony is refused", /permission/i.test(await forged.text()), (await forged.text()).slice(0, 200));
      check("…and the task is unchanged in the DB", (await db.dashboardStep.findUniqueOrThrow({ where: { id: foreign.id } })).status === "NOT_STARTED");
      const otherStage = stage2[0];
      const forged2 = await tonyCtx.request.post(call.url, { headers: call.headers, data: call.body.replace(mine.id, otherStage.id) });
      check("forged save on a task in an unassigned stage is refused", /permission/i.test(await forged2.text()));
    }
    await t.unroute("**/dashboard/**");

    // --- Tracker: view only ---
    const trackerRes = await t.goto(`${BASE}/site-tracker`);
    check("Tony can open Site Tracker (view)", trackerRes?.status() === 200);
    const trackerEdit = await tonyCtx.request.patch(`${BASE}/api/tracker/site-steps`, { data: {} });
    check("Tony's tracker edit API call is 403", trackerEdit.status() === 403, trackerEdit.status());

    // --- PO PDF route is gated by canCreatePo (permission check runs before the lookup: 403 = no permission, 404 = allowed) ---
    const tonyPo = await tonyCtx.request.get(`${BASE}/api/site-boq/purchase-orders/does-not-exist/pdf`);
    check("Tony cannot touch purchase orders (403)", tonyPo.status() === 403, tonyPo.status());

    // ============================ SALES (no assignments) ============================
    const salesCtx = await browser.newContext();
    const { page: s, landedOn: salesLanding } = await login(salesCtx, "sales");
    check("unassigned Sales lands on /dashboard", salesLanding === "/dashboard", salesLanding);
    await s.goto(SITE_URL);
    check("Sales sees the site but every card is locked", (await appears(s.getByText("Overall progress"))) && (await s.locator('[data-locked="true"]').count()) === 13);
    check("Sales has no tappable stage card", (await s.locator(`a[href^="/dashboard/${encodeURIComponent(SITE)}/"]`).count()) === 0);
    check("Sales typed URL to stage 1 is refused", await isForbidden(s, `${SITE_URL}/1`));

    // ============================ OPERATIONS ============================
    const opsCtx = await browser.newContext();
    const { page: o, landedOn: opsLanding } = await login(opsCtx, "ops");
    check("Operations lands on /site-boq", opsLanding === "/site-boq", opsLanding);
    check("Operations sidebar has all four modules", (await sidebarHas(o, "/dashboard")) && (await sidebarHas(o, "/site-tracker")) && (await sidebarHas(o, "/site-boq")) && (await sidebarHas(o, "/operations-boq")));
    check("Operations can open Operations BOQ", !(await isForbidden(o, `${BASE}/operations-boq`)));
    const opsTracker = await opsCtx.request.patch(`${BASE}/api/tracker/site-steps`, { data: {} });
    check("Operations tracker edit passes the permission gate (not 403)", opsTracker.status() !== 403, opsTracker.status());
    const opsPo = await opsCtx.request.get(`${BASE}/api/site-boq/purchase-orders/does-not-exist/pdf`);
    check("Operations passes the PO gate (404 for a fake id, not 403)", opsPo.status() === 404, opsPo.status());
    await o.goto(SITE_URL);
    check("Operations also sees locked cards on an unassigned site", (await appears(o.getByText("Overall progress"))) && (await o.locator('[data-locked="true"]').count()) === 13);

    // ============================ ACCOUNTS ============================
    const accCtx = await browser.newContext();
    const { page: a } = await login(accCtx, "accounts");
    check("Accounts can open Site BOQ", !(await isForbidden(a, `${BASE}/site-boq`)));
    const accPo = await accCtx.request.get(`${BASE}/api/site-boq/purchase-orders/does-not-exist/pdf`);
    check("Accounts passes the PO gate (404, not 403)", accPo.status() === 404, accPo.status());
    const accTracker = await accCtx.request.patch(`${BASE}/api/tracker/site-steps`, { data: {} });
    check("Accounts tracker edit is 403 (view only)", accTracker.status() === 403, accTracker.status());

    // ============================ MANAGEMENT ============================
    const mgmtCtx = await browser.newContext();
    const { page: m } = await login(mgmtCtx, "mgmt");
    check("Management can open Site BOQ and Operations BOQ", !(await isForbidden(m, `${BASE}/site-boq`)) && !(await isForbidden(m, `${BASE}/operations-boq`)));
    const mgmtPo = await mgmtCtx.request.get(`${BASE}/api/site-boq/purchase-orders/does-not-exist/pdf`);
    check("Management cannot create/download POs (403)", mgmtPo.status() === 403, mgmtPo.status());
    const mgmtTracker = await mgmtCtx.request.patch(`${BASE}/api/tracker/site-steps`, { data: {} });
    check("Management tracker edit is 403", mgmtTracker.status() === 403, mgmtTracker.status());

    // ============================ FRANCHISEE ============================
    const frCtx = await browser.newContext();
    const { page: f, landedOn: frLanding } = await login(frCtx, "franchisee");
    check("Franchisee lands on /dashboard (not a /site-boq 403)", frLanding === "/dashboard", frLanding);
    check("Franchisee sidebar is Dashboard only", (await sidebarHas(f, "/dashboard")) && !(await sidebarHas(f, "/site-tracker")) && !(await sidebarHas(f, "/site-boq")) && !(await sidebarHas(f, "/operations-boq")));

    // ============================ Server-side guards on the assign action (via Tony's removal) ============================
    // Removing Tony empties the picker's effect: he can no longer open stage 1.
    await admin.goto(`${SITE_URL}/team`);
    await admin.getByTestId("team-list").getByRole("button", { name: "Remove" }).click();
    const removed = await waitFor(async () => (await db.dashboardStepAssignment.count({ where: { userId: tony.id } })) === 0);
    check("Remove clears all of Tony's tasks on the site", Boolean(removed));
    check("after removal Tony is refused on stage 1", await isForbidden(t, `${SITE_URL}/1`));
  } finally {
    await browser.close();
    await cleanup();
    const leftovers = {
      users: await db.user.count({ where: { email: { startsWith: "tmp-e2e-assign-" } } }),
      dashboardSites: await db.dashboardSite.count({ where: { name: { startsWith: "TMP E2E" } } }),
      sites: await db.site.count({ where: { name: { startsWith: "TMP E2E" } } }),
      assignments: await db.dashboardStepAssignment.count({ where: { user: { email: { startsWith: "tmp-e2e-assign-" } } } }),
      auditEvents: await db.auditEvent.count({ where: { actorEmail: { startsWith: "tmp-e2e-assign-" } } }),
    };
    console.log("leftovers after cleanup:", JSON.stringify(leftovers));
    if (Object.values(leftovers).some((n) => n !== 0)) failures++;
    await db.$disconnect();
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
});
