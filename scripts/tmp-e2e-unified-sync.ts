import "dotenv/config";
import "./lib/require-fixture-opt-in";
import { createHash } from "node:crypto";
import http from "node:http";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createThrowawayAdmin, deleteThrowawayAdmin, THROWAWAY_ADMIN_PASSWORD } from "./lib/throwaway-admin";
import { ensureOpsBoqRows } from "../src/lib/ops-boq-ensure";

/**
 * Unified Sync button (Dashboard / Site Tracker / Site BOQ / Operations BOQ) end
 * to end, with NO Google in the loop: a fake Apps Script web app (below) plays
 * the three sheets' doPost — it answers the website's kick, then calls the same
 * start/chunk/finish/commit routes the real WebsiteSync.js files will.
 *
 * It is a FIXTURE PUSH: the Site BOQ and Dashboard commits are full-snapshot, so
 * they deactivate every real site/item not in the fixture. Run it ONLY through
 * the snapshot/restore helper (CLAUDE.md "Test data and the .env database", rule 3):
 *
 *   E2E_ALLOW_FIXTURE_PUSH=1 npx tsx scripts/db-restore.ts run scripts/tmp-e2e-unified-sync.ts
 *
 * The server under test must run with the fake sheets' URLs and the same secrets:
 *   SYNC_STAGES_WEBAPP_URL=http://127.0.0.1:3199/stages  SYNC_SITE_BOQ_WEBAPP_URL=http://127.0.0.1:3199/boq
 *   SYNC_OPS_BOQ_WEBAPP_URL=http://127.0.0.1:3199/ops    OPS_BOQ_SYNC_SECRET=<any value, also exported to this script>
 * and E2E_BASE_URL points at it (default http://localhost:3000).
 */

const db = new PrismaClient();
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const FAKE_PORT = Number(process.env.E2E_FAKE_SHEET_PORT ?? 3199);
const SECRETS = {
  stages: process.env.DASHBOARD_SYNC_SECRET ?? "",
  boq: process.env.SHEET_SYNC_SECRET ?? "",
  ops: process.env.OPS_BOQ_SYNC_SECRET ?? "",
};
for (const [k, v] of Object.entries(SECRETS)) if (!v) throw new Error(`secret for "${k}" is not set in the environment`);

const ADMIN_EMAIL = "tmp-e2e-unified-sync-admin@example.com";
const ALPHA = "TMP E2E Alpha"; // new site: created by the sync
const BEETA = "TMP E2E Beeta"; // sheet spelling; SiteAlias -> BETA (no duplicate created)
const BETA = "TMP E2E Beta"; // existing shared Site (tracker seed style key)
const WEB = "TMP E2E Web"; // website-created site: the sync must never touch it
const OPSONLY = "TMP E2E OpsOnly"; // exists only in the Ops sheet
const ITEM_KEY = "TMP-E2E-ITEM-1";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(cond ? "OK  " : "FAIL", "-", label, cond || detail === undefined ? "" : JSON.stringify(detail));
  if (!cond) failures++;
}
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// ---------------------------------------------------------------- fake sheets

type StepSpec = { key: string; parent: string | null; label: string; parentRow?: boolean; status?: string | null; assignedTo?: string | null; remark?: string | null };

const scenario = {
  /** Stage 7 steps per site name; mutate between syncs to simulate a sheet edit. */
  stage7: new Map<string, StepSpec[]>(),
  boqQty: 5,
  opsVendor: "OSAMA2",
  fail: { stages: false, boq: false, ops: false },
  category: "Probes",
};
const calls = { chunks: 0, boqChunks: 0, opsTabsSent: 0, kicks: [] as string[] };

function siteFixture(name: string, steps: StepSpec[], sortOrder: number) {
  return {
    name,
    sortOrder,
    driveFolderUrl: null,
    stages: [
      {
        stageNo: 7,
        stageName: "Stage 7 - Construction Execution",
        steps: steps.map((s, i) => ({
          stepKey: s.key,
          parentKey: s.parent,
          label: s.label,
          sortOrder: i + 1,
          isParent: s.parentRow === true,
          assignedTo: s.assignedTo ?? null,
          status: s.parentRow ? null : (s.status ?? "Not started"),
          remark: s.remark ?? null,
          shared: false,
          deliverables: [],
        })),
      },
    ],
  };
}

async function post(path: string, body: unknown, secret: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function runStages(batchId: string) {
  const sites = [...scenario.stage7].map(([name, steps], i) => siteFixture(name, steps, i + 1));
  const manifest = sites.map((s) => ({ name: s.name, hash: sha(s) }));
  const start = (await post(
    "/api/dashboard-sync/start",
    { requestId: null, trigger: "button", sheetName: "fake", sheetId: "fake", siteCount: sites.length, deptLinks: [], batchId, manifest },
    SECRETS.stages
  )) as { runId: string; changed: string[] };
  const changed = new Set(start.changed);
  for (const site of sites) {
    if (!changed.has(site.name)) continue;
    calls.chunks++;
    await post("/api/dashboard-sync/chunk", { runId: start.runId, site }, SECRETS.stages);
  }
  await post("/api/dashboard-sync/finish", { runId: start.runId, expected: { sites: changed.size } }, SECRETS.stages);
}

async function runBoq(batchId: string) {
  const tab = {
    category: scenario.category,
    tab: `RM - ${scenario.category}`,
    vendors: [],
    items: [
      {
        itemKey: ITEM_KEY,
        row: 5,
        sNo: 1,
        name: "TMP E2E Item 1",
        finalRate: 100,
        rateMissing: false,
        finalVendor: null,
        vendorRates: {},
        notes: null,
        // WEB is deliberately NOT a site in the sheet's sites[], and the item
        // payload mentions it: its SiteItems must survive.
        sites: { [ALPHA]: { qty: scenario.boqQty }, [WEB]: { qty: 99 } },
      },
    ],
  };
  const start = (await post(
    "/api/sheet-sync/start",
    {
      requestId: null,
      trigger: "button",
      sheetName: "fake",
      sheetId: "fake",
      sites: [{ position: 1, name: ALPHA }],
      lockedSites: [],
      tabCount: 1,
      batchId,
      tabManifest: [{ category: tab.category, hash: sha(tab) }],
    },
    SECRETS.boq
  )) as { runId: string; changed: string[] };
  let expectedItems = 0;
  let expectedTabs = 0;
  if (start.changed.includes(tab.category)) {
    calls.boqChunks++;
    await post("/api/sheet-sync/chunk", { runId: start.runId, tab }, SECRETS.boq);
    expectedItems = tab.items.length;
    expectedTabs = 1;
  }
  await post("/api/sheet-sync/finish", { runId: start.runId, expected: { tabs: expectedTabs, items: expectedItems, sites: 1 } }, SECRETS.boq);
}

async function runOps(batchId: string) {
  const row = (name: string, sno: number | null, over: Record<string, unknown> = {}) => ({
    name,
    sno,
    vendor: null,
    boqStatus: null,
    amount: null,
    linkBoq: null,
    linkApprovedBoq: null,
    linkPo: null,
    approvedVia: null,
    link: null,
    advanceGiven: null,
    stage: null,
    followUpDate: null,
    remarks: null,
    ...over,
  });
  const tabs = [
    {
      tabName: ALPHA.toUpperCase(),
      rows: [
        row("CROCKERY", 2, { vendor: scenario.opsVendor, boqStatus: "SHARED", amount: "₹1,000", advanceGiven: 400, linkBoq: "https://example.com/boq", followUpDate: "2026-12-01" }),
        row("FLOWER VASE", 12, { vendor: "Vase Co", amount: 50 }),
        row("TOTAL", null),
      ],
    },
    { tabName: OPSONLY.toUpperCase(), rows: [row("GLASSWARE", 3, { vendor: "BENTEX2" })] },
    { tabName: WEB.toUpperCase(), rows: [row("CROCKERY", 2, { vendor: "SHOULD NOT LAND" })] },
  ].map((t) => ({ ...t, hash: sha(t) }));
  calls.opsTabsSent += tabs.length;
  await post("/api/ops-boq-sync/commit", { batchId, sheetName: "fake", tabs }, SECRETS.ops);
}

function startFakeSheets(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const send = (obj: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    try {
      const leg = (req.url ?? "").replace(/^\//, "") as "stages" | "boq" | "ops";
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { secret?: string; batchId?: string };
      calls.kicks.push(leg);
      if (!["stages", "boq", "ops"].includes(leg) || body.secret !== SECRETS[leg] || !body.batchId) return send({ ok: false, error: "bad request/secret" });
      if (scenario.fail[leg]) return send({ ok: false, error: "simulated failure" });
      if (leg === "stages") await runStages(body.batchId);
      else if (leg === "boq") await runBoq(body.batchId);
      else await runOps(body.batchId);
      send({ ok: true });
    } catch (err) {
      send({ ok: false, error: err instanceof Error ? err.message : "error" });
    }
  });
  return new Promise((resolve) => server.listen(FAKE_PORT, "127.0.0.1", () => resolve(server)));
}

// ------------------------------------------------------------------- helpers

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(THROWAWAY_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90000, waitUntil: "commit" });
}

/** Press Sync and wait until every chip has left "running". Returns the chip states. */
async function pressSyncAndWait(page: Page, expectLegs = 3) {
  await page.getByTestId("unified-sync-button").click();
  await page.waitForFunction(
    (n) => {
      const chips = [...document.querySelectorAll('[data-testid^="sync-chip-"]')];
      return chips.length === n && chips.every((c) => c.getAttribute("data-state") !== "running");
    },
    expectLegs,
    { timeout: 120_000 }
  );
  const states: Record<string, string> = {};
  for (const chip of await page.locator('[data-testid^="sync-chip-"]').all()) {
    states[(await chip.getAttribute("data-testid"))!.replace("sync-chip-", "")] = (await chip.getAttribute("data-state"))!;
  }
  return states;
}

async function lastBatchLegs(adminId: string) {
  const batch = await db.syncBatch.findFirst({ where: { triggeredById: adminId }, orderBy: { startedAt: "desc" }, include: { legs: true } });
  return batch;
}

// ---------------------------------------------------------------------- main

async function main() {
  await createThrowawayAdmin(db, ADMIN_EMAIL);
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const codes = await db.trackerStep.findMany({ where: { code: { startsWith: "7." }, synthetic: false }, orderBy: { code: "asc" }, take: 2, select: { code: true, name: true } });
  if (codes.length < 2) throw new Error("preview DB has no Stage 7 tracker steps — cannot run");
  const [c1, c2] = codes;
  const hasDeepCleaning = (await db.trackerStep.count({ where: { code: "7.18.1" } })) > 0;

  // Fixtures that must already exist on the website side.
  const betaSite = await db.site.create({ data: { sourceKey: "TRACKER-tmp-e2e-beta", name: BETA, usedInBoq: false, usedInTracker: false } });
  await db.siteAlias.create({ data: { aliasNorm: BEETA.toLowerCase(), siteId: betaSite.id } });
  const webSite = await db.site.create({ data: { sourceKey: "WEB-tmp-e2e-web", name: WEB, usedInBoq: true, usedInTracker: true } });
  await ensureOpsBoqRows(db, webSite.id);
  const webDash = await db.dashboardSite.create({ data: { name: WEB, origin: "WEBSITE", isActive: true } });
  await db.dashboardStep.create({
    data: { siteId: webDash.id, stageNo: 7, stageName: "Stage 7", stepKey: "w1", label: `${c1.code} website-only step`, sortOrder: 1, isParent: false, status: "COMPLETED", shared: false, deliverables: [] },
  });

  const stepsFor = (status1: string, status2: string): StepSpec[] => [
    { key: "10", parent: null, label: "7.1 Section", parentRow: true },
    { key: "11", parent: "10", label: `${c1.code} ${c1.name}`, status: status1, assignedTo: "Ravi", remark: "from sheet" },
    { key: "12", parent: "10", label: `${c2.code} ${c2.name}`, status: status2 },
    ...(hasDeepCleaning ? [{ key: "13", parent: "10", label: "Deep Cleaning", status: "In progress" } as StepSpec] : []),
  ];
  scenario.stage7.set(ALPHA, stepsFor("Completed", "Not started"));
  scenario.stage7.set(BEETA, stepsFor("In progress", "Completed"));
  scenario.stage7.set(WEB, stepsFor("Not started", "Not started")); // a website site named in the sheet: must be ignored

  const fake = await startFakeSheets();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Unauthenticated callers get nothing.
    const anon = await fetch(`${BASE}/api/sync/run`, { method: "POST", redirect: "manual" });
    check("unauthenticated POST /api/sync/run is refused (not 2xx)", !anon.ok && anon.status !== 200, anon.status);

    await login(page);
    await page.goto(`${BASE}/dashboard`);
    await page.getByTestId("unified-sync-button").waitFor({ timeout: 120000 });
    check("admin sees the Sync button on the Dashboard", true);
    for (const p of ["/site-tracker", "/site-boq", "/site-boq/items", "/operations-boq"]) {
      await page.goto(`${BASE}${p}`, { timeout: 120000 });
      await page.getByTestId("unified-sync-button").waitFor({ timeout: 120000 }).catch(() => {});
      check(`Sync button on ${p}`, await page.getByTestId("unified-sync-button").isVisible());
    }
    await page.goto(`${BASE}/dashboard`);

    // ---------------------------------------------------------- 1st sync (everything is new)
    const t0 = Date.now();
    const states = await pressSyncAndWait(page);
    const firstMs = Date.now() - t0;
    console.log(`     first sync took ${firstMs} ms`);
    check("1st sync: all three chips done", Object.values(states).every((s) => s === "done"), states);

    const batch1 = await lastBatchLegs(admin.id);
    check("1st sync: one batch with 3 COMMITTED legs, batch finished", batch1?.legs.length === 3 && batch1.legs.every((l) => l.status === "COMMITTED") && batch1.finishedAt !== null);
    // Three legs run in parallel; whichever reaches a new site first creates it, so look at all legs.
    const created = (batch1?.legs ?? []).flatMap((l) => (l.createdSites as string[] | null) ?? []).map((n) => n.toLowerCase());
    check("1st sync: new sites are reported (Alpha), the alias-matched Beeta and the website site are not", created.includes(ALPHA.toLowerCase()) && !created.includes(BEETA.toLowerCase()) && !created.includes(WEB.toLowerCase()), created);
    check("no shared Site named 'TMP E2E Beeta' was created", (await db.site.count({ where: { name: BEETA } })) === 0);

    const alpha = await db.site.findUnique({ where: { name: ALPHA } });
    check("Alpha is a SHEET- site flagged usedInTracker", !!alpha && alpha.sourceKey.startsWith("SHEET-") && alpha.usedInTracker === true);
    const betaAfter = await db.site.findUnique({ where: { id: betaSite.id } });
    check("Beta (matched via alias) is now usedInTracker", betaAfter?.usedInTracker === true);

    const alphaDash = await db.dashboardSite.findUnique({ where: { name: ALPHA }, include: { steps: true } });
    check(`Alpha dashboard site has its ${stepsFor("", "").length} synced steps`, alphaDash?.origin === "SHEET" && alphaDash.steps.length === stepsFor("", "").length, alphaDash?.steps.length);
    const webDashAfter = await db.dashboardSite.findUnique({ where: { name: WEB }, include: { steps: true } });
    check("website dashboard site untouched (still 1 website step)", webDashAfter?.origin === "WEBSITE" && webDashAfter.steps.length === 1 && webDashAfter.steps[0].stepKey === "w1");

    const alphaTracker = await db.trackerSiteStep.findMany({ where: { siteId: alpha!.id }, include: { step: true } });
    const aStep = alphaTracker.find((t) => t.step.code === c1.code);
    check("tracker: Alpha's Completed step landed as COMPLETED + legacyCompleted + completedAt", aStep?.status === "COMPLETED" && aStep.legacyCompleted && aStep.completedAt !== null, aStep);
    check("tracker: assignee/remark carried over", aStep?.assignee === "Ravi" && aStep?.remark === "from sheet");
    check("tracker: a Not-started, no-remark step created no row (lazy tracker)", !alphaTracker.some((t) => t.step.code === c2.code));
    if (hasDeepCleaning) check("tracker: Deep Cleaning leaf mapped to 7.18.1", alphaTracker.some((t) => t.step.code === "7.18.1" && t.status === "IN_PROGRESS"));
    const betaTracker = await db.trackerSiteStep.findMany({ where: { siteId: betaSite.id }, include: { step: true } });
    check("tracker: Beta (via alias) got rows", betaTracker.length >= 2, betaTracker.length);
    check("tracker: nothing written for the website site", (await db.trackerSiteStep.count({ where: { siteId: webSite.id } })) === 0);

    const item = await db.item.findUnique({ where: { sourceKey: ITEM_KEY } });
    const alphaItem = item && alpha ? await db.siteItem.findUnique({ where: { siteId_itemId: { siteId: alpha.id, itemId: item.id } } }) : null;
    check("site BOQ: item created and Alpha's qty = 5", !!item?.isActive && alphaItem?.qty.toNumber() === 5, alphaItem?.qty);
    const archivedWeb = await db.site.findUnique({ where: { id: webSite.id } });
    check("site BOQ: website site not archived (usedInBoq still true)", archivedWeb?.usedInBoq === true);

    const alphaOps = await db.opsBoqRow.findMany({ where: { siteId: alpha!.id }, orderBy: { sortOrder: "asc" } });
    const crock = alphaOps.find((r) => r.fixedKey === "CROCKERY");
    check("ops: CROCKERY row matched + updated (vendor, SHARED, amount 1000, advance 400, link, date)", crock?.vendor === "OSAMA2" && crock.boqStatus === "SHARED" && crock.amount?.toNumber() === 1000 && crock.advanceGiven?.toNumber() === 400 && crock.linkBoq === "https://example.com/boq" && crock.followUpDate?.toISOString().slice(0, 10) === "2026-12-01", crock);
    const vase = alphaOps.find((r) => r.name === "FLOWER VASE");
    check("ops: FLOWER VASE became an added row (fromSheet)", !!vase && vase.fromSheet && !vase.isFixed && vase.fixedKey === null);
    check("ops: Alpha has 11 fixed + 1 added rows (TOTAL skipped)", alphaOps.length === 12, alphaOps.length);
    // Created with the TAB's spelling (UPPERCASE in the fake sheet), so look it up case-insensitively.
    const opsOnly = await db.site.findFirst({ where: { name: { equals: OPSONLY, mode: "insensitive" } } });
    check("ops: Ops-only site created and not usedInBoq", !!opsOnly && opsOnly.usedInBoq === false);
    const webOps = await db.opsBoqRow.findMany({ where: { siteId: webSite.id } });
    check("ops: website site's rows untouched (11 rows, default vendor kept)", webOps.length === 11 && !webOps.some((r) => r.vendor === "SHOULD NOT LAND"));

    // Pages show the synced data.
    await page.goto(`${BASE}/operations-boq?site=${opsOnly!.id}`, { timeout: 120000 });
    await page.getByTestId("ops-boq-row").first().waitFor({ timeout: 120000 }).catch(() => {});
    check("Ops BOQ page lists a site that is NOT in Site BOQ (picker uses getOpsBoqSites)", (await page.getByTestId("ops-boq-row").count()) > 0);
    await page.goto(`${BASE}/site-tracker`, { timeout: 120000 });
    await page.getByTestId("unified-sync-button").waitFor({ timeout: 120000 }).catch(() => {});
    check("Site Tracker page loads after the sync", await page.getByTestId("unified-sync-button").isVisible());
    await page.goto(`${BASE}/dashboard`);

    // ---------------------------------------------------------- 2nd sync (nothing changed)
    calls.chunks = 0;
    calls.boqChunks = 0;
    const t1 = Date.now();
    const states2 = await pressSyncAndWait(page);
    console.log(`     no-change sync took ${Date.now() - t1} ms`);
    check("2nd sync: all done", Object.values(states2).every((s) => s === "done"), states2);
    const batch2 = await lastBatchLegs(admin.id);
    const sc2 = batch2?.legs.find((l) => l.leg === "STAGES")?.counts as { sites?: number; unchangedSites?: number } | null;
    const bc2 = batch2?.legs.find((l) => l.leg === "SITE_BOQ")?.counts as { categories?: number; unchangedTabs?: number } | null;
    const oc2 = batch2?.legs.find((l) => l.leg === "OPS_BOQ")?.counts as { changedTabs?: number; unchangedTabs?: number } | null;
    check("2nd sync: dashboard sent 0 chunks, all sites unchanged", calls.chunks === 0 && sc2?.sites === 0 && (sc2?.unchangedSites ?? 0) >= 2, { calls: calls.chunks, sc2 });
    check("2nd sync: site BOQ sent 0 chunks, tab unchanged", calls.boqChunks === 0 && bc2?.categories === 0 && bc2?.unchangedTabs === 1, { calls: calls.boqChunks, bc2 });
    check("2nd sync: ops wrote 0 tabs (all unchanged)", oc2?.changedTabs === 0 && (oc2?.unchangedTabs ?? 0) >= 2, oc2);
    check("2nd sync: unchanged sites were NOT archived", (await db.dashboardSite.findUnique({ where: { name: ALPHA } }))?.isActive === true);
    check("2nd sync: the BOQ item stayed active (unchanged tab still 'seen')", (await db.item.findUnique({ where: { sourceKey: ITEM_KEY } }))?.isActive === true);

    // ---------------------------------------------------------- 3rd sync (one site changes, one tracker row edited on the website)
    await db.siteItem.create({ data: { siteId: webSite.id, itemId: item!.id, qty: 3 } }); // website-owned data on a sheet item
    const betaStepRow = betaTracker.find((t) => t.step.code === c1.code)!;
    await db.trackerSiteStep.update({ where: { id: betaStepRow.id }, data: { status: "NOT_STARTED", remark: "edited on website", updatedById: admin.id } });
    scenario.stage7.set(ALPHA, stepsFor("In progress", "Not started")); // Completed -> In progress
    scenario.stage7.set(BEETA, stepsFor("Completed", "Completed")); // changes too, but Beta's c1 row is website-edited
    scenario.boqQty = 7;
    calls.chunks = 0;
    const states3 = await pressSyncAndWait(page);
    check("3rd sync: all done", Object.values(states3).every((s) => s === "done"), states3);
    check("3rd sync: only the 2 changed sites were chunked (website site excluded)", calls.chunks === 2, calls.chunks);
    const aStep3 = await db.trackerSiteStep.findFirst({ where: { siteId: alpha!.id, step: { code: c1.code } } });
    check("3rd sync: Alpha's tracker row followed the sheet (IN_PROGRESS), legacyCompleted stays sticky, completedAt cleared", aStep3?.status === "IN_PROGRESS" && aStep3.legacyCompleted === true && aStep3.completedAt === null, aStep3);
    const bStep3 = await db.trackerSiteStep.findUnique({ where: { id: betaStepRow.id } });
    check("3rd sync: website-edited tracker row NOT overwritten", bStep3?.status === "NOT_STARTED" && bStep3.remark === "edited on website", bStep3);
    const bOther = await db.trackerSiteStep.findFirst({ where: { siteId: betaSite.id, step: { code: c2.code }, updatedById: null } });
    check("3rd sync: Beta's other (unedited) row did update", bOther?.status === "COMPLETED", bOther);
    const alphaItem3 = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId: alpha!.id, itemId: item!.id } } });
    check("3rd sync: Alpha's BOQ qty updated to 7", alphaItem3?.qty.toNumber() === 7);
    const webItem = await db.siteItem.findUnique({ where: { siteId_itemId: { siteId: webSite.id, itemId: item!.id } } });
    check("3rd sync: website site's SiteItem survived the stale-delete (qty still 3)", webItem?.qty.toNumber() === 3, webItem);

    // ---------------------------------------------------------- duplicate press = one batch
    const before = await db.syncBatch.count({ where: { triggeredById: admin.id } });
    scenario.stage7.set(ALPHA, stepsFor("Completed", "Not started")); // so it actually runs a little
    const [r1, r2] = await Promise.all(
      [1, 2].map(() => page.evaluate(async () => (await fetch("/api/sync/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()))
    );
    check("two simultaneous presses attach to ONE batch", r1.batchId === r2.batchId && [r1.created, r2.created].filter(Boolean).length === 1, { r1, r2 });
    await page.waitForFunction(async () => (await (await fetch("/api/sync/status")).json()).active === false, undefined, { timeout: 120000, polling: 1000 });
    check("…and only one new SyncBatch exists", (await db.syncBatch.count({ where: { triggeredById: admin.id } })) === before + 1);

    // ---------------------------------------------------------- one leg fails -> others fine, Retry works
    scenario.fail.ops = true;
    await page.goto(`${BASE}/dashboard`);
    const states4 = await pressSyncAndWait(page);
    check("failed leg: Stages + Site BOQ done, Ops BOQ failed", states4.STAGES === "done" && states4.SITE_BOQ === "done" && states4.OPS_BOQ === "failed", states4);
    const batch4 = await lastBatchLegs(admin.id);
    const ops4 = batch4?.legs.find((l) => l.leg === "OPS_BOQ");
    check("failed leg is FAILED in the DB with a safe message", ops4?.status === "FAILED" && /simulated failure/.test(ops4.errorMessage ?? "") && !/127\.0\.0\.1|secret/i.test(ops4.errorMessage ?? ""), ops4?.errorMessage);
    check("failed leg shows a Retry button", await page.getByTestId("sync-retry-OPS_BOQ").isVisible());
    scenario.fail.ops = false;
    await page.getByTestId("sync-retry-OPS_BOQ").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-chip-OPS_BOQ"]')?.getAttribute("data-state") === "done", undefined, { timeout: 60000 });
    const batch5 = await lastBatchLegs(admin.id);
    check("Retry created a new batch containing ONLY the Ops BOQ leg, and it committed", batch5?.legs.length === 1 && batch5.legs[0].leg === "OPS_BOQ" && batch5.legs[0].status === "COMMITTED", batch5?.legs);

    // ---------------------------------------------------------- status endpoint is a pure read
    const runsBefore = await db.dashboardSyncRun.count();
    for (let i = 0; i < 3; i++) await page.evaluate(() => fetch("/api/sync/status"));
    check("GET /api/sync/status wrote nothing", (await db.dashboardSyncRun.count()) === runsBefore);
  } finally {
    await browser.close().catch(() => {});
    fake.close();
    await cleanup(admin.id);
  }
}

async function cleanup(adminId: string) {
  const sites = await db.site.findMany({ where: { name: { startsWith: "TMP E2E" } }, select: { id: true } });
  await db.siteItem.deleteMany({ where: { item: { sourceKey: { startsWith: "TMP-E2E" } } } });
  await db.item.deleteMany({ where: { sourceKey: { startsWith: "TMP-E2E" } } });
  await db.site.deleteMany({ where: { id: { in: sites.map((s) => s.id) } } }); // cascades tracker rows, ops rows, aliases
  await db.dashboardSite.deleteMany({ where: { name: { startsWith: "TMP E2E" } } }); // cascades steps
  await db.syncContentHash.deleteMany({ where: { unitKey: { startsWith: "tmp e2e" } } });
  await db.syncBatch.deleteMany({ where: { triggeredById: adminId } }); // cascades legs
  await deleteThrowawayAdmin(db, ADMIN_EMAIL);
  await db.session.deleteMany({ where: { user: { email: ADMIN_EMAIL } } }).catch(() => {});

  const [s, d, i, a, u, b, h, t, o] = await Promise.all([
    db.site.count({ where: { name: { startsWith: "TMP E2E" } } }),
    db.dashboardSite.count({ where: { name: { startsWith: "TMP E2E" } } }),
    db.item.count({ where: { sourceKey: { startsWith: "TMP-E2E" } } }),
    db.siteAlias.count({ where: { aliasNorm: { startsWith: "tmp e2e" } } }),
    db.user.count({ where: { email: { startsWith: "tmp-e2e-unified" } } }),
    db.syncBatch.count({ where: { triggeredById: adminId } }),
    db.syncContentHash.count({ where: { unitKey: { startsWith: "tmp e2e" } } }),
    db.trackerSiteStep.count({ where: { site: { name: { startsWith: "TMP E2E" } } } }),
    db.opsBoqRow.count({ where: { site: { name: { startsWith: "TMP E2E" } } } }),
  ]);
  console.log("cleanup proof (all should be 0):", JSON.stringify({ sites: s, dashboardSites: d, items: i, aliases: a, users: u, batches: b, hashes: h, trackerRows: t, opsRows: o }));
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
