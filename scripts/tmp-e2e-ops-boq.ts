import "dotenv/config";
import { chromium, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { OPS_BOQ_FIXED_ROWS } from "../src/lib/ops-boq-seed";
import { ensureOpsBoqRows } from "../src/lib/ops-boq-ensure";

/**
 * Operations BOQ acceptance pass (operations-boq-handoff.md section 11) in a
 * real Chromium against `pnpm dev` and the .env database. NOT a fixture-push
 * script (no snapshot/restore needed): it creates its own throwaway users
 * (ADMIN, OPERATIONS, MANAGEMENT = can view but read-only (the SALES const name is historical), FRANCHISEE) and two sites,
 * "TMP E2E Ops Site" / "TMP E2E Ops Site 2", through the real Dashboard "New
 * site" flow, and removes everything it made (rows, audit events, sites,
 * dashboard sites, users) in `finally`. Refuses a DB host in E2E_FORBIDDEN_DB_HOSTS.
 *
 * Server-side permission checks are tested by replaying the exact Server Action
 * POSTs the UI sent (same Next-Action id, body with the row id swapped) from a
 * read-only / franchisee session, and against a fixed row.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TmpE2eOps123!";
const SITE = "TMP E2E Ops Site";
const SITE2 = "TMP E2E Ops Site 2";
const NAME_PREFIX = "TMP E2E Ops Site";
const USERS: Record<string, Role> = {
  "tmp-e2e-opsboq-admin@example.com": "ADMIN",
  "tmp-e2e-opsboq-ops@example.com": "OPERATIONS",
  "tmp-e2e-opsboq-sales@example.com": "MANAGEMENT",
  "tmp-e2e-opsboq-franchisee@example.com": "FRANCHISEE",
};
const [ADMIN, OPS, SALES, FRANCHISEE] = Object.keys(USERS);

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
  const sites = await db.site.findMany({ where: { name: { startsWith: NAME_PREFIX } }, select: { id: true } });
  const dsites = await db.dashboardSite.findMany({ where: { name: { startsWith: NAME_PREFIX } }, select: { id: true } });
  const rows = await db.opsBoqRow.findMany({ where: { siteId: { in: sites.map((s) => s.id) } }, select: { id: true } });
  await db.auditEvent.deleteMany({
    where: {
      OR: [
        { actorEmail: { in: Object.keys(USERS) } },
        { entityType: "OpsBoqRow", entityId: { in: rows.map((r) => r.id) } },
        { entityId: { in: [...sites.map((s) => s.id), ...dsites.map((s) => s.id)] } },
      ],
    },
  });
  await db.dashboardSite.deleteMany({ where: { id: { in: dsites.map((s) => s.id) } } });
  await db.site.deleteMany({ where: { id: { in: sites.map((s) => s.id) } } }); // cascades OpsBoqRow
  await db.user.deleteMany({ where: { email: { in: Object.keys(USERS) } } });
}

/** The table is server-rendered before React hydrates; an edit typed before hydration is silently dropped, so wait for the page to settle. */
async function tableReady(page: Page) {
  await page.getByTestId("ops-boq-table").waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

/** Runs a UI edit and waits for its Server Action POST to finish (they queue one at a time; each is a few DB round trips). */
async function saving(page: Page, action: () => Promise<void>) {
  const done = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/operations-boq"), { timeout: 90000 });
  await action();
  await done;
}

/** A Server Action call as the browser sent it, so it can be replayed from another session. */
type ActionCall = { url: string; headers: Record<string, string>; body: string };

function captureActions(page: Page, store: Map<string, ActionCall>, tag: (req: Request) => string | null) {
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const key = tag(req);
    if (!key) return;
    const headers = req.headers();
    store.set(key, {
      url: req.url(),
      headers: {
        "next-action": headers["next-action"] ?? "",
        "content-type": headers["content-type"] ?? "text/plain;charset=UTF-8",
        accept: headers["accept"] ?? "text/x-component",
        "next-router-state-tree": headers["next-router-state-tree"] ?? "",
      },
      body: req.postData() ?? "",
    });
  });
}

async function replay(context: BrowserContext, call: ActionCall, swap: [string, string][]): Promise<string> {
  let body = call.body;
  for (const [from, to] of swap) body = body.split(from).join(to);
  const res = await context.request.post(call.url, { headers: call.headers, data: body });
  return res.text();
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

  const browser: Browser = await chromium.launch();
  try {
    // ---------- Admin: create two sites through the real Dashboard flow ----------
    const adminCtx = await browser.newContext();
    const admin = await login(adminCtx, ADMIN);
    for (const name of [SITE, SITE2]) {
      await admin.goto(`${BASE}/dashboard`);
      await admin.getByRole("button", { name: "New site" }).click();
      await admin.getByLabel("Site name").fill(name);
      await admin.getByRole("button", { name: "Create site" }).click();
      await admin.waitForURL(`**/dashboard/${encodeURIComponent(name)}`, { timeout: 60000 });
    }
    const site = await db.site.findUniqueOrThrow({ where: { name: SITE } });
    const site2 = await db.site.findUniqueOrThrow({ where: { name: SITE2 } });

    // ---------- 1. Seeding: exactly 11 rows, right names/S.No/vendors; idempotent ----------
    const seeded = await db.opsBoqRow.findMany({ where: { siteId: site.id }, orderBy: { sortOrder: "asc" } });
    check("new site got exactly 11 rows", seeded.length === 11, seeded.length);
    check(
      "rows have the right S.No, names and default vendors, in order",
      JSON.stringify(seeded.map((r) => [r.sno, r.name, r.vendor, r.isFixed])) ===
        JSON.stringify(OPS_BOQ_FIXED_ROWS.map((r) => [r.sno, r.name, r.vendor, true])),
    );
    check("every row defaults to NOT_SHARED with no amount", seeded.every((r) => r.boqStatus === "NOT_SHARED" && r.amount === null));
    const rerun1 = await ensureOpsBoqRows(db, site.id);
    const rerun2 = await ensureOpsBoqRows(db, site.id);
    check("ensureOpsBoqRows twice creates nothing", rerun1 === 0 && rerun2 === 0);
    check("still exactly 11 rows after re-running", (await db.opsBoqRow.count({ where: { siteId: site.id } })) === 11);
    // Concurrent runs must not duplicate either.
    await Promise.all([ensureOpsBoqRows(db, site.id), ensureOpsBoqRows(db, site.id), ensureOpsBoqRows(db, site.id)]);
    check("still 11 rows after 3 concurrent runs", (await db.opsBoqRow.count({ where: { siteId: site.id } })) === 11);
    check("second site also has its own 11 rows", (await db.opsBoqRow.count({ where: { siteId: site2.id } })) === 11);
    const crockery = seeded.find((r) => r.fixedKey === "CROCKERY")!;
    const probes = seeded.find((r) => r.fixedKey === "PROBES")!;

    // ---------- 2. Admin UI ----------
    const calls = new Map<string, ActionCall>();
    captureActions(admin, calls, (req) => {
      const body = req.postData() ?? "";
      if (!req.url().includes("/operations-boq")) return null;
      if (body.includes('"amount"') && !calls.has("update")) return "update";
      if (body.includes(site.id) && body.includes("TMP E2E RO") && !calls.has("add")) return "add";
      return null;
    });

    await admin.goto(`${BASE}/operations-boq`);
    await admin.getByText("Select a site to see its Operations BOQ.").waitFor({ timeout: 60000 });
    check("nothing is shown until a site is selected", (await admin.getByTestId("ops-boq-table").count()) === 0);
    check(
      "sidebar shows Operations BOQ as a live link for Admin",
      (await admin.getByRole("link", { name: "Operations BOQ" }).first().getAttribute("href")) === "/operations-boq",
    );

    await admin.getByRole("combobox", { name: "Select Site" }).click();
    await admin.getByRole("option", { name: SITE, exact: true }).click();
    await tableReady(admin);

    const headers = (await admin.locator("[data-testid=ops-boq-table] thead th").allTextContents()).map((t) => t.trim()).filter(Boolean); // textContent: the CSS uppercase is display-only
    check(
      "columns are in the documented order with fixed labels",
      JSON.stringify(headers) ===
        JSON.stringify([
          "S.No", "Name", "Vendor", "BOQ Status", "Amount", "Link of BOQ", "Link of Approved BOQ", "Link of PO",
          "Approved Via", "Link", "Advance Given", "Stage", "Follow Up", "Pending Amount", "Remarks", "Actions",
        ]),
      headers,
    );
    check("table shows the site's 11 rows", (await admin.getByTestId("ops-boq-row").count()) === 11);
    check("default vendor is prefilled", (await admin.getByLabel("Vendor for CROCKERY", { exact: true }).inputValue()) === "OSAMA");
    check("Pending shows '-' while Amount is empty", (await admin.getByTestId("ops-boq-row").filter({ hasText: "CROCKERY" }).getByTestId("ops-boq-pending").innerText()).trim() === "-");

    // BOQ Status options
    await admin.getByRole("combobox", { name: "BOQ Status for CROCKERY" }).click();
    const statusOptions = (await admin.getByRole("option").allInnerTexts()).map((t) => t.trim());
    check("BOQ Status offers only NOT SHARED and SHARED", JSON.stringify(statusOptions) === JSON.stringify(["NOT SHARED", "SHARED"]), statusOptions);
    await saving(admin, () => admin.getByRole("option", { name: "SHARED", exact: true }).click());
    check("choosing SHARED saves", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } })).boqStatus === "SHARED");

    // Amount / Advance -> Pending + totals, live and after reload
    const crockeryRow = admin.getByTestId("ops-boq-row").filter({ hasText: "CROCKERY" });
    await saving(admin, async () => {
      await admin.getByLabel("Amount for CROCKERY", { exact: true }).fill("100000");
      await admin.getByLabel("Amount for CROCKERY", { exact: true }).press("Enter");
    });
    await crockeryRow.getByTestId("ops-boq-pending").getByText("₹1,00,000").waitFor({ timeout: 15000 });
    check("Pending updates instantly (Indian grouping, ₹)", true);
    await saving(admin, async () => {
      await admin.getByLabel("Advance Given for CROCKERY", { exact: true }).fill("25000");
      await admin.getByLabel("Advance Given for CROCKERY", { exact: true }).press("Enter");
    });
    await crockeryRow.getByTestId("ops-boq-pending").getByText("₹75,000").waitFor({ timeout: 15000 });
    check("Pending = Amount - Advance Given", true);
    await saving(admin, async () => {
      await admin.getByLabel("Amount for PROBES", { exact: true }).fill("50,000");
      await admin.getByLabel("Amount for PROBES", { exact: true }).press("Enter");
    });
    await admin.getByTestId("ops-boq-total-amount").getByText("₹1,50,000").waitFor({ timeout: 15000 });
    check("total Amount row updates instantly", (await admin.getByTestId("ops-boq-total-advance").innerText()).trim() === "₹25,000");
    check("total Pending row updates instantly", (await admin.getByTestId("ops-boq-total-pending").innerText()).trim() === "₹1,25,000");
    const saved = await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } });
    check("Amount/Advance are stored (Pending is not a column)", Number(saved.amount) === 100000 && Number(saved.advanceGiven) === 25000 && !("pending" in saved));
    await admin.reload();
    await tableReady(admin);
    check("after reload the same site is shown (URL has ?site=)", admin.url().includes(`site=${site.id}`));
    check("Pending persists after reload", (await admin.getByTestId("ops-boq-row").filter({ hasText: "CROCKERY" }).getByTestId("ops-boq-pending").innerText()).includes("₹75,000"));
    check("totals persist after reload", (await admin.getByTestId("ops-boq-total-amount").innerText()).trim() === "₹1,50,000");
    check("summary strip shows BOQs shared 1 / 11", (await admin.getByText("1 / 11").count()) > 0);

    // Invalid input is rejected and the cell reverts
    await admin.getByLabel("Amount for CROCKERY", { exact: true }).fill("abc");
    await admin.getByLabel("Amount for CROCKERY", { exact: true }).press("Enter");
    await admin.getByText(/must be a number/i).first().waitFor({ timeout: 10000 });
    check("invalid Amount is rejected with a message and the old value stays", (await admin.getByLabel("Amount for CROCKERY", { exact: true }).inputValue()) === "₹1,00,000");

    // Failed save reverts the cell (network failure simulated)
    await admin.route("**/operations-boq**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await admin.getByLabel("Vendor for POS", { exact: true }).fill("SHOULD NOT STICK");
    await admin.getByLabel("Vendor for POS", { exact: true }).press("Enter");
    await admin.getByText(/Could not save the change/i).first().waitFor({ timeout: 15000 });
    check("a failed save reverts the cell and shows a toast", (await admin.getByLabel("Vendor for POS", { exact: true }).inputValue()) === "TOUCH INFOMATICS");
    await admin.unroute("**/operations-boq**");

    // Links
    await admin.getByLabel("Link of BOQ for PROBES", { exact: true }).fill("javascript:alert(1)");
    await admin.getByLabel("Link of BOQ for PROBES", { exact: true }).press("Enter");
    await admin.getByText(/must start with http/i).first().waitFor({ timeout: 10000 });
    check("a non-http(s) link is rejected and not stored", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: probes.id } })).linkBoq === null);
    await saving(admin, async () => {
      await admin.getByLabel("Link of BOQ for PROBES", { exact: true }).fill("https://example.com/boq");
      await admin.getByLabel("Link of BOQ for PROBES", { exact: true }).press("Enter");
    });
    const open = admin.getByRole("link", { name: "Open Link of BOQ for PROBES" });
    await open.waitFor({ timeout: 15000 });
    check("a filled link shows 'Open' (new tab, rel noopener)", (await open.getAttribute("target")) === "_blank" && (await open.getAttribute("href")) === "https://example.com/boq" && ((await open.getAttribute("rel")) ?? "").includes("noopener"));

    // Follow-up red + advance warning
    const probesRow = admin.getByTestId("ops-boq-row").filter({ hasText: "PROBES" });
    await saving(admin, () => admin.getByLabel("Follow Up for PROBES", { exact: true }).fill("2020-01-01"));
    await probesRow.getByTestId("ops-boq-overdue").waitFor({ timeout: 15000 });
    check("past Follow Up with pending balance is shown red", ((await admin.getByLabel("Follow Up for PROBES", { exact: true }).getAttribute("class")) ?? "").includes("text-destructive"));
    await saving(admin, () => admin.getByLabel("Follow Up for CROCKERY", { exact: true }).fill("2099-01-01"));
    check("future Follow Up is not red", (await admin.getByTestId("ops-boq-row").filter({ hasText: "CROCKERY" }).getByTestId("ops-boq-overdue").count()) === 0);
    await saving(admin, async () => {
      await admin.getByLabel("Advance Given for PROBES", { exact: true }).fill("60000");
      await admin.getByLabel("Advance Given for PROBES", { exact: true }).press("Enter");
    });
    await probesRow.getByTestId("ops-boq-advance-warning").waitFor({ timeout: 15000 });
    check("Advance > Amount shows a warning, Pending is red", ((await probesRow.getByTestId("ops-boq-pending").locator("span").first().getAttribute("class")) ?? "").includes("text-destructive"));
    check("Advance > Amount is still saved (not blocked)", Number((await db.opsBoqRow.findUniqueOrThrow({ where: { id: probes.id } })).advanceGiven) === 60000);
    check("no Overdue once nothing is pending (negative pending)", (await probesRow.getByTestId("ops-boq-overdue").count()) === 0);

    // Fixed rows: no delete, name locked (UI)
    check("fixed row has no Delete button", (await admin.getByRole("button", { name: "Delete CROCKERY" }).count()) === 0);
    check("fixed row name is not editable", (await admin.getByLabel("Name of CROCKERY").count()) === 0);

    // Add / rename / delete an added row (site 1 only)
    await admin.getByRole("button", { name: "Add item" }).click();
    await admin.getByLabel("New item name").fill("TMP E2E RO & GEYSER");
    await saving(admin, () => admin.getByRole("button", { name: "Add", exact: true }).click());
    await admin.locator('[data-testid=ops-boq-row][data-row-name="TMP E2E RO & GEYSER"]').waitFor({ timeout: 15000 });
    const added = await db.opsBoqRow.findFirstOrThrow({ where: { siteId: site.id, name: "TMP E2E RO & GEYSER" } });
    check("added row is not fixed and gets S.No = max + 1 (11)", !added.isFixed && added.fixedKey === null && added.sno === "11", added);
    check("added rows appear only on that site", (await db.opsBoqRow.count({ where: { siteId: site2.id } })) === 11 && (await db.opsBoqRow.count({ where: { siteId: site.id } })) === 12);

    const renameInput = admin.getByLabel("Name of TMP E2E RO & GEYSER", { exact: true });
    const renameReq = admin.waitForRequest((r) => r.method() === "POST" && r.url().includes("/operations-boq") && (r.postData() ?? "").includes("RENAMED"));
    await saving(admin, async () => {
      await renameInput.fill("TMP E2E RO RENAMED");
      await renameInput.press("Enter");
    });
    calls.set("rename", await requestToCall(await renameReq));
    check("added row can be renamed", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: added.id } })).name === "TMP E2E RO RENAMED");

    // Switch to site 2: has its own table, without the added row
    await admin.getByRole("combobox", { name: "Select Site" }).click();
    await admin.getByRole("option", { name: SITE2, exact: true }).click();
    await admin.waitForURL(`**site=${site2.id}`, { timeout: 30000 });
    await tableReady(admin);
    await admin.waitForFunction(() => document.querySelectorAll("[data-testid=ops-boq-row]").length > 0);
    check("site 2's table has 11 rows and not the added one", (await admin.getByTestId("ops-boq-row").count()) === 11 && (await admin.locator('[data-row-name="TMP E2E RO RENAMED"]').count()) === 0);
    await admin.goto(`${BASE}/operations-boq`);
    await admin.waitForURL((u) => u.search.includes("site="), { timeout: 20000 }).catch(() => {});
    check("the last selected site is remembered when none is in the URL", admin.url().includes(`site=${site2.id}`));
    await admin.goto(`${BASE}/operations-boq?site=${site.id}`);
    await tableReady(admin);

    // Delete with confirm
    const delReq = admin.waitForRequest((r) => r.method() === "POST" && r.url().includes("/operations-boq") && (r.postData() ?? "").includes(added.id) && !(r.postData() ?? "").includes("RENAMED"));
    await admin.getByRole("button", { name: "Delete TMP E2E RO RENAMED" }).click();
    check("delete asks for confirmation first", await admin.getByRole("dialog").getByText(/can.t be undone/i).isVisible());
    await saving(admin, () => admin.getByRole("button", { name: "Delete row" }).click());
    calls.set("delete", await requestToCall(await delReq));
    await admin.locator('[data-testid=ops-boq-row][data-row-name="TMP E2E RO RENAMED"]').waitFor({ state: "detached", timeout: 15000 });
    check("added row can be deleted", (await db.opsBoqRow.count({ where: { id: added.id } })) === 0);

    // ---------- 3. Server-side: fixed rows (API) ----------
    const updateCall = calls.get("update");
    const renameCall = calls.get("rename");
    const deleteCall = calls.get("delete");
    check("captured the real update/rename/delete Server Action calls", !!updateCall && !!renameCall && !!deleteCall, [...calls.keys()]);
    const nameBefore = crockery.name;
    const renameFixed = await replay(adminCtx, renameCall!, [[added.id, crockery.id]]);
    check("API refuses to rename a fixed row", /can.t be renamed/.test(renameFixed), renameFixed.slice(0, 200));
    check("fixed row name unchanged in DB", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } })).name === nameBefore);
    const deleteFixed = await replay(adminCtx, deleteCall!, [[added.id, crockery.id]]);
    check("API refuses to delete a fixed row", /can.t be deleted/.test(deleteFixed), deleteFixed.slice(0, 200));
    check("fixed row still exists", (await db.opsBoqRow.count({ where: { id: crockery.id } })) === 1);
    const badField = await replay(adminCtx, updateCall!, [['"amount"', '"fixedKey"']]);
    check("API refuses to edit a non-editable field (fixedKey)", /Invalid request/.test(badField), badField.slice(0, 200));

    // ---------- 4. Audit log ----------
    const events = await db.auditEvent.findMany({ where: { entityType: "OpsBoqRow", actorEmail: ADMIN } });
    const byField = (f: string) => events.filter((e) => e.action === "UPDATE" && e.newValue && typeof e.newValue === "object" && f in (e.newValue as object));
    const amountEvent = byField("amount").find((e) => e.entityId === crockery.id);
    check("amount change is audited with who/old/new/site/row/field", !!amountEvent && JSON.stringify(amountEvent.oldValue) === '{"amount":null}' && JSON.stringify(amountEvent.newValue) === '{"amount":100000}' && (amountEvent.reference ?? "").startsWith(`${SITE} · CROCKERY · amount`), amountEvent);
    check("advance, status, vendor-less cells, link, follow-up all audited", byField("advanceGiven").length >= 2 && byField("boqStatus").length === 1 && byField("linkBoq").length === 1 && byField("followUpDate").length >= 2);
    check("add / rename / delete are audited", events.some((e) => e.action === "CREATE" && e.entityId === added.id) && byField("name").length === 1 && events.some((e) => e.action === "DELETE" && e.entityId === added.id));
    check("failed/invalid saves are not audited (no 'abc', no javascript:)", !events.some((e) => JSON.stringify(e.newValue).includes("abc") || JSON.stringify(e.newValue).includes("javascript")));
    await admin.goto(`${BASE}/site-boq/settings`);
    await admin.getByText("Ops Boq Row").first().waitFor({ timeout: 60000 }).catch(() => {});
    check("changes appear in the existing audit viewer (Site BOQ settings)", (await admin.getByText("Ops Boq Row").count()) > 0);

    // ---------- 5. OPERATIONS role can edit ----------
    const opsCtx = await browser.newContext();
    const opsPage = await login(opsCtx, OPS);
    await opsPage.goto(`${BASE}/operations-boq?site=${site.id}`);
    await tableReady(opsPage);
    check("OPERATIONS role sees editable inputs and Add item", (await opsPage.getByLabel("Stage for CROCKERY", { exact: true }).isEnabled()) && (await opsPage.getByRole("button", { name: "Add item" }).count()) === 1);
    await saving(opsPage, async () => {
      await opsPage.getByLabel("Stage for CROCKERY", { exact: true }).fill("PO raised");
      await opsPage.getByLabel("Stage for CROCKERY", { exact: true }).press("Enter");
    });
    check("OPERATIONS role's edit is saved", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } })).stage === "PO raised");

    // ---------- 6. Read-only internal role ----------
    const salesCtx = await browser.newContext();
    const sales = await login(salesCtx, SALES);
    check("read-only role still sees the sidebar item", (await sales.getByRole("link", { name: "Operations BOQ" }).count()) > 0);
    await sales.goto(`${BASE}/operations-boq?site=${site.id}`);
    await tableReady(sales);
    const enabled = await sales.locator("[data-testid=ops-boq-table] input:not([disabled]), [data-testid=ops-boq-table] button[role=combobox]:not([disabled])").count();
    check("read-only role: every input and select is disabled", enabled === 0, enabled);
    check("read-only role: no Add item and no Delete", (await sales.getByRole("button", { name: "Add item" }).count()) === 0 && (await sales.getByRole("button", { name: /^Delete / }).count()) === 0);
    check("read-only role still sees the data", (await sales.getByTestId("ops-boq-total-amount").innerText()).trim() === "₹1,50,000");
    const salesUpdate = await replay(salesCtx, updateCall!, [[crockery.id, crockery.id], ['"amount"', '"stage"']]);
    check("read-only role: API write is refused (403-equivalent)", /permission/i.test(salesUpdate), salesUpdate.slice(0, 200));
    const addCall = calls.get("add");
    check("captured the real add-row call", !!addCall);
    const salesAdd = await replay(salesCtx, addCall!, []);
    check("read-only role: add-row is refused too", /permission/i.test(salesAdd), salesAdd.slice(0, 200));
    const salesDelete = await replay(salesCtx, deleteCall!, [[added.id, probes.id]]);
    check("read-only role: delete is refused and the row is untouched", /permission/i.test(salesDelete) && (await db.opsBoqRow.count({ where: { id: probes.id } })) === 1, salesDelete.slice(0, 200));
    check("read-only write did not change the DB", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } })).stage === "PO raised");

    // ---------- 7. Franchisee ----------
    const franCtx = await browser.newContext();
    const fran = await login(franCtx, FRANCHISEE);
    check("franchisee: no Operations BOQ in the sidebar", (await fran.getByText("Operations BOQ").count()) === 0);
    const resp = await fran.goto(`${BASE}/operations-boq?site=${site.id}`);
    // The forbidden UI streams in after the shell; in this dev run EVERY internal-only module (existing Site BOQ / Site Tracker included) answers with HTTP 200 + the 403 screen, so the status code is informational only.
    await fran.getByText(/internal-only module/i).first().waitFor({ timeout: 30000 }).catch(() => {});
    console.log(`INFO - franchisee GET /operations-boq HTTP status: ${resp?.status()}`);
    check("franchisee: page shows the 403 Forbidden screen, no table, no data", (await fran.getByText("403 — Forbidden").count()) > 0 && (await fran.getByTestId("ops-boq-table").count()) === 0 && (await fran.getByText("TMP E2E Ops Site").count()) === 0);
    const franUpdate = await replay(franCtx, updateCall!, [['"amount"', '"stage"']]);
    check("franchisee: API write is refused", /permission/i.test(franUpdate), franUpdate.slice(0, 200));
    check("franchisee write did not change the DB", (await db.opsBoqRow.findUniqueOrThrow({ where: { id: crockery.id } })).stage === "PO raised");

    // ---------- 8. Existing pages still work ----------
    for (const path of ["/dashboard", "/site-tracker", "/site-boq", "/site-boq/sites", "/site-boq/items"]) {
      const r = await admin.goto(`${BASE}${path}`);
      await admin.waitForLoadState("networkidle");
      check(`existing page ${path} still loads (200, no error page)`, r?.status() === 200 && (await admin.getByText(/something went wrong|application error/i).count()) === 0, r?.status());
    }
  } finally {
    await browser.close();
    await cleanup();
    const leftovers = {
      sites: await db.site.count({ where: { name: { startsWith: NAME_PREFIX } } }),
      dashboardSites: await db.dashboardSite.count({ where: { name: { startsWith: NAME_PREFIX } } }),
      users: await db.user.count({ where: { email: { in: Object.keys(USERS) } } }),
      opsRowsOnTmpSites: await db.opsBoqRow.count({ where: { site: { name: { startsWith: NAME_PREFIX } } } }),
      audit: await db.auditEvent.count({ where: { actorEmail: { in: Object.keys(USERS) } } }),
    };
    check("no leftover test rows", Object.values(leftovers).every((n) => n === 0), leftovers);
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function requestToCall(req: Request): Promise<ActionCall> {
  const headers = req.headers();
  return {
    url: req.url(),
    headers: {
      "next-action": headers["next-action"] ?? "",
      "content-type": headers["content-type"] ?? "text/plain;charset=UTF-8",
      accept: headers["accept"] ?? "text/x-component",
      "next-router-state-tree": headers["next-router-state-tree"] ?? "",
    },
    body: req.postData() ?? "",
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
