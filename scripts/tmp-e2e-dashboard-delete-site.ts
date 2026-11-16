import "dotenv/config";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Dashboard "Delete site" (type-to-confirm). Needs `pnpm dev` + the .env DB.
 * Creates throwaway users (ADMIN, SALES) and "TMP E2E Del ..." sites through the
 * real "New site" flow, and removes everything it made in `finally`. Does not
 * create tracker evidence files (that would touch the B2 bucket configured in
 * .env), so the storage-cleanup step is not exercised here.
 * Refuses a DB host listed in E2E_FORBIDDEN_DB_HOSTS.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TmpE2eDel123!";
const PREFIX = "TMP E2E Del";
const OK_SITE = `${PREFIX} Ok`;
const WRONG_SITE = `${PREFIX} Wrong`;
const PO_SITE = `${PREFIX} Po`;
const SHEET_SITE = `${PREFIX} Sheet`;
const VENDOR = `${PREFIX} Vendor`;
const USERS: Record<string, Role> = {
  "tmp-e2e-delsite-admin@example.com": "ADMIN",
  "tmp-e2e-delsite-sales@example.com": "SALES",
};
const [ADMIN, SALES] = Object.keys(USERS);

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(cond ? "OK  " : "FAIL", "-", label, cond || detail === undefined ? "" : `(${JSON.stringify(detail)})`);
  if (!cond) failures++;
}

async function login(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
  return page;
}

async function cleanup() {
  const sites = await db.site.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const dsites = await db.dashboardSite.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  await db.purchaseOrder.deleteMany({ where: { siteId: { in: sites.map((s) => s.id) } } });
  await db.vendor.deleteMany({ where: { name: VENDOR } });
  await db.auditEvent.deleteMany({
    where: {
      OR: [
        { actorEmail: { in: Object.keys(USERS) } },
        { entityId: { in: [...sites.map((s) => s.id), ...dsites.map((s) => s.id)] } },
        { reference: { startsWith: `Deleted site "${PREFIX}` } },
      ],
    },
  });
  await db.dashboardSite.deleteMany({ where: { id: { in: dsites.map((s) => s.id) } } });
  await db.site.deleteMany({ where: { id: { in: sites.map((s) => s.id) } } });
  await db.user.deleteMany({ where: { email: { in: Object.keys(USERS) } } });
}

async function createSiteViaUi(page: Page, name: string) {
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Site name").fill(name);
  await page.getByRole("button", { name: "Create site" }).click();
  await page.waitForURL(`**/dashboard/${encodeURIComponent(name)}`, { timeout: 60000 });
}

async function openDeleteDialog(page: Page, name: string) {
  await page.goto(`${BASE}/dashboard/${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: "Delete site" }).waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // hydration: a click before it is silently dropped
  await page.getByRole("button", { name: "Delete site" }).click();
  await page.getByRole("dialog").waitFor();
}

async function main() {
  const host = new URL(process.env.DATABASE_URL!).host;
  const forbidden = (process.env.E2E_FORBIDDEN_DB_HOSTS ?? "").split(",").filter(Boolean);
  if (forbidden.some((h) => host.includes(h))) throw new Error(`Refusing to run against ${host}`);

  await cleanup();
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const [email, role] of Object.entries(USERS)) {
    await db.user.create({ data: { email, name: `Tmp ${role}`, role, passwordHash, isActive: true } });
  }
  const adminUser = await db.user.findUniqueOrThrow({ where: { email: ADMIN } });

  const browser = await chromium.launch();
  try {
    const adminCtx = await browser.newContext();
    const admin = await login(adminCtx, ADMIN);
    for (const name of [OK_SITE, WRONG_SITE, PO_SITE]) await createSiteViaUi(admin, name);

    const okDash = await db.dashboardSite.findUniqueOrThrow({ where: { name: OK_SITE } });
    const okSite = await db.site.findUniqueOrThrow({ where: { name: OK_SITE } });
    const wrongDash = await db.dashboardSite.findUniqueOrThrow({ where: { name: WRONG_SITE } });
    const poSite = await db.site.findUniqueOrThrow({ where: { name: PO_SITE } });

    // Something attached in every module, so the cascade is proven and not vacuous.
    const trackerStep = await db.trackerStep.findFirstOrThrow({ select: { id: true } });
    await db.trackerSiteStep.create({ data: { siteId: okSite.id, stepId: trackerStep.id, status: "IN_PROGRESS" } });
    const before = {
      dashboardSteps: await db.dashboardStep.count({ where: { siteId: okDash.id } }),
      opsRows: await db.opsBoqRow.count({ where: { siteId: okSite.id } }),
      trackerSteps: await db.trackerSiteStep.count({ where: { siteId: okSite.id } }),
    };
    check("test site has data in Dashboard, Ops BOQ and Tracker before deleting", before.dashboardSteps > 100 && before.opsRows === 11 && before.trackerSteps === 1, before);

    // ---------- Dialog: type-to-confirm ----------
    await openDeleteDialog(admin, OK_SITE);
    const dialog = admin.getByRole("dialog");
    const phrase = `Delete site ${OK_SITE}`;
    const deleteBtn = dialog.getByRole("button", { name: "Delete site" });
    const input = dialog.getByLabel(/Type .* to confirm/);
    check("dialog shows the exact phrase to type", (await dialog.getByText(phrase, { exact: true }).count()) > 0);
    check("Delete is disabled before typing anything", await deleteBtn.isDisabled());
    await input.fill(OK_SITE);
    check("Delete stays disabled for just the site name", await deleteBtn.isDisabled());
    await input.fill(phrase.toLowerCase());
    check("Delete stays disabled when the case is wrong", await deleteBtn.isDisabled());
    await input.fill(phrase.slice(0, -1));
    check("Delete stays disabled for a phrase that is one character short", await deleteBtn.isDisabled());

    // Cancel does nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" });
    check("Cancel closes the dialog and deletes nothing", (await db.dashboardSite.count({ where: { id: okDash.id } })) === 1);

    // ---------- Server re-checks the phrase (UI tampering) ----------
    // Capture the real action call by rewriting the typed phrase on the wire to a wrong one.
    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    await openDeleteDialog(admin, WRONG_SITE);
    await admin.route("**/dashboard/**", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && (req.postData() ?? "").includes(wrongDash.id)) {
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
        await route.continue({ postData: (req.postData() ?? "").replace(`Delete site ${WRONG_SITE}`, "Delete site Something Else") });
      } else {
        await route.continue();
      }
    });
    const wrongDialog = admin.getByRole("dialog");
    await wrongDialog.getByLabel(/Type .* to confirm/).fill(`Delete site ${WRONG_SITE}`);
    await wrongDialog.getByRole("button", { name: "Delete site" }).click();
    await wrongDialog.getByText(/confirmation text does not match/i).waitFor({ timeout: 30000 });
    check("server refuses a call whose phrase doesn't match (even though the UI allowed it)", (await db.dashboardSite.count({ where: { id: wrongDash.id } })) === 1);
    await admin.unroute("**/dashboard/**");
    check("captured the real delete Server Action call", !!captured);

    // ---------- Non-admin ----------
    const salesCtx = await browser.newContext();
    const sales = await login(salesCtx, SALES);
    await sales.goto(`${BASE}/dashboard/${encodeURIComponent(WRONG_SITE)}`);
    await sales.getByText("Overall progress").waitFor({ timeout: 60000 });
    check("non-admin does not see the Delete site button", (await sales.getByRole("button", { name: "Delete site" }).count()) === 0);
    const call = captured as { url: string; headers: Record<string, string>; body: string } | null;
    const salesRes = await salesCtx.request.post(call!.url, {
      headers: call!.headers,
      data: call!.body.replace("Delete site Something Else", `Delete site ${WRONG_SITE}`),
    });
    check("non-admin replaying the call with the CORRECT phrase is refused", /permission/i.test(await salesRes.text()) && (await db.dashboardSite.count({ where: { id: wrongDash.id } })) === 1);

    // ---------- Sheet-origin site: no button, server refuses ----------
    const sheetDash = await db.dashboardSite.create({ data: { name: SHEET_SITE, origin: "SHEET" } });
    await admin.goto(`${BASE}/dashboard/${encodeURIComponent(SHEET_SITE)}`);
    await admin.getByText("Overall progress").waitFor({ timeout: 60000 });
    check("sheet-synced site has no Delete site button", (await admin.getByRole("button", { name: "Delete site" }).count()) === 0);
    const sheetRes = await adminCtx.request.post(call!.url, {
      headers: call!.headers,
      data: call!.body.replace(wrongDash.id, sheetDash.id).replace("Delete site Something Else", `Delete site ${SHEET_SITE}`),
    });
    check("server refuses to delete a sheet-synced site", /website-created/i.test(await sheetRes.text()) && (await db.dashboardSite.count({ where: { id: sheetDash.id } })) === 1);

    // ---------- Purchase orders block the delete ----------
    const category = await db.category.findFirstOrThrow({ select: { id: true } });
    const vendor = await db.vendor.create({ data: { name: VENDOR } });
    await db.purchaseOrder.create({
      data: {
        poNumber: `TMP-E2E-DEL-${Date.now()}`,
        siteId: poSite.id,
        categoryId: category.id,
        vendorId: vendor.id,
        poDate: new Date(),
        deliveryDays: 7,
        paymentTerms: "x",
        gstPercent: 18,
        subtotal: 100,
        gstAmount: 18,
        total: 118,
        createdById: adminUser.id,
        companySnapshot: {},
        vendorSnapshot: {},
        siteSnapshot: {},
        termsSnapshot: {},
      },
    });
    await openDeleteDialog(admin, PO_SITE);
    const poDialog = admin.getByRole("dialog");
    await poDialog.getByLabel(/Type .* to confirm/).fill(`Delete site ${PO_SITE}`);
    await poDialog.getByRole("button", { name: "Delete site" }).click();
    await poDialog.getByText(/1 purchase order and cannot be deleted/i).waitFor({ timeout: 30000 });
    check("a site with a purchase order can't be deleted (clear message, nothing removed)", (await db.dashboardSite.count({ where: { name: PO_SITE } })) === 1 && (await db.site.count({ where: { id: poSite.id } })) === 1 && (await db.opsBoqRow.count({ where: { siteId: poSite.id } })) === 11);

    // ---------- The real delete ----------
    await openDeleteDialog(admin, OK_SITE);
    const okDialog = admin.getByRole("dialog");
    await okDialog.getByLabel(/Type .* to confirm/).fill(phrase);
    check("Delete enables once the exact phrase is typed", await okDialog.getByRole("button", { name: "Delete site" }).isEnabled());
    await okDialog.getByRole("button", { name: "Delete site" }).click();
    await admin.waitForURL(`${BASE}/dashboard`, { timeout: 60000 });
    check("after deleting, you land on the Dashboard list", admin.url() === `${BASE}/dashboard`);
    check("Dashboard list no longer shows the site", (await admin.getByText(OK_SITE, { exact: true }).count()) === 0);
    check("Dashboard site and its steps are gone", (await db.dashboardSite.count({ where: { id: okDash.id } })) === 0 && (await db.dashboardStep.count({ where: { siteId: okDash.id } })) === 0);
    check("linked shared Site, Ops BOQ rows and Tracker steps are gone", (await db.site.count({ where: { id: okSite.id } })) === 0 && (await db.opsBoqRow.count({ where: { siteId: okSite.id } })) === 0 && (await db.trackerSiteStep.count({ where: { siteId: okSite.id } })) === 0);
    check("other sites are untouched", (await db.dashboardSite.count({ where: { id: wrongDash.id } })) === 1 && (await db.opsBoqRow.count({ where: { siteId: poSite.id } })) === 11);
    const audit = await db.auditEvent.findFirst({ where: { entityType: "DashboardSite", entityId: okDash.id, action: "DELETE" } });
    const removed = (audit?.oldValue as { removed?: Record<string, number> } | null)?.removed;
    check("delete is audited with who and what was removed", !!audit && audit.actorEmail === ADMIN && removed?.opsBoqRows === 11 && removed?.trackerSteps === 1 && (removed?.dashboardSteps ?? 0) > 100, audit?.oldValue);
    for (const path of ["/site-tracker", "/site-boq", "/site-boq/sites", "/operations-boq", "/dashboard"]) {
      const r = await admin.goto(`${BASE}${path}`, { timeout: 120000 }); // first compile of a route in dev can be slow
      await admin.waitForLoadState("networkidle");
      check(`${path} still loads after a site was deleted`, r?.status() === 200 && (await admin.getByText(/something went wrong|application error/i).count()) === 0, r?.status());
    }
    const gone = await admin.goto(`${BASE}/dashboard/${encodeURIComponent(OK_SITE)}`, { timeout: 120000 });
    await admin.waitForLoadState("networkidle"); // the 404 UI streams in after the (app)/loading.tsx placeholder
    check("the deleted site's URL is a 404", gone?.status() === 404 || (await admin.getByText(/not found|404/i).count()) > 0);
  } finally {
    await browser.close();
    await cleanup();
    const leftovers = {
      sites: await db.site.count({ where: { name: { startsWith: PREFIX } } }),
      dashboardSites: await db.dashboardSite.count({ where: { name: { startsWith: PREFIX } } }),
      users: await db.user.count({ where: { email: { in: Object.keys(USERS) } } }),
      vendors: await db.vendor.count({ where: { name: VENDOR } }),
      pos: await db.purchaseOrder.count({ where: { poNumber: { startsWith: "TMP-E2E-DEL-" } } }),
      audit: await db.auditEvent.count({ where: { actorEmail: { in: Object.keys(USERS) } } }),
      opsRows: await db.opsBoqRow.count({ where: { site: { name: { startsWith: PREFIX } } } }),
    };
    check("no leftover test rows", Object.values(leftovers).every((n) => n === 0), leftovers);
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
