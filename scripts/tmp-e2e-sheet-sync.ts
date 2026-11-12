import "dotenv/config";
import "./lib/require-fixture-opt-in";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * docs/sheet-sync/CLAUDE_CODE_HANDOFF.md section 9's full test checklist,
 * driven by the real docs/sheet-sync/sample-payload.json. Run with
 * `npx tsx scripts/tmp-e2e-sheet-sync.ts` against a running `pnpm dev`.
 *
 * Ends by re-pushing the full, unmodified payload once more so the dev DB's
 * final state reflects the real sheet data (no sites left artificially
 * archived from the test-7 step) — matching plan.md's open item that the
 * real sheet data has never actually been imported.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const SHEET_SYNC_SECRET = process.env.SHEET_SYNC_SECRET!;
if (!SHEET_SYNC_SECRET) throw new Error("SHEET_SYNC_SECRET not set");

const ADMIN_EMAIL = "tmp-e2e-sheet-sync-admin@example.com";
const ADMIN_PASSWORD = "TmpE2eSheetSync123!";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

type Payload = {
  start: { requestId: string | null; trigger: string; sheetName: string; sheetId: string; sites: unknown[]; lockedSites: string[]; tabCount: number };
  chunks: { tab: { category: string; tab: string; vendors: string[]; items: { itemKey: string; name: string; sites: Record<string, unknown> }[] } }[];
  finish: { expected: { tabs: number; items: number; sites: number } };
};

function loadPayload(): Payload {
  const raw = readFileSync(path.join(process.cwd(), "docs/sheet-sync/sample-payload.json"), "utf-8");
  return JSON.parse(raw) as Payload;
}

async function callSync(pathSuffix: string, body: unknown, opts: { secret?: string; method?: string } = {}) {
  const res = await fetch(`${BASE}${pathSuffix}`, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.secret !== undefined ? { Authorization: `Bearer ${opts.secret}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

async function runFullSync(payload: Payload, opts: { retryFirstChunk?: boolean } = {}) {
  const start = await callSync("/api/sheet-sync/start", payload.start, { secret: SHEET_SYNC_SECRET });
  if (!start.ok) throw new Error(`start failed: ${JSON.stringify(start.json)}`);
  const runId = (start.json as { runId: string }).runId;

  for (const [i, chunk] of payload.chunks.entries()) {
    const res = await callSync("/api/sheet-sync/chunk", { runId, tab: chunk.tab }, { secret: SHEET_SYNC_SECRET });
    if (!res.ok) throw new Error(`chunk ${chunk.tab.category} failed: ${JSON.stringify(res.json)}`);
    if (i === 0 && opts.retryFirstChunk) {
      const retry = await callSync("/api/sheet-sync/chunk", { runId, tab: chunk.tab }, { secret: SHEET_SYNC_SECRET });
      if (!retry.ok) throw new Error(`retried chunk ${chunk.tab.category} failed: ${JSON.stringify(retry.json)}`);
    }
  }

  const finish = await callSync("/api/sheet-sync/finish", { runId, expected: payload.finish.expected }, { secret: SHEET_SYNC_SECRET });
  return { runId, finish };
}

async function snapshot() {
  const [items, siteItems, vendors, sites] = await Promise.all([
    db.item.count({ where: { isActive: true } }),
    db.siteItem.count(),
    db.vendor.count(),
    db.site.count({ where: { usedInBoq: true } }),
  ]);
  return { items, siteItems, vendors, sites };
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function setMode(mode: "SHEET_LIVE" | "WEBSITE_LIVE") {
  await db.appSetting.upsert({ where: { key: "mode" }, update: { value: mode }, create: { key: "mode", value: mode } });
}

async function resetSheetSyncRequestState() {
  await db.appSetting.upsert({
    where: { key: "sheetSyncRequest" },
    update: { value: { status: "idle", requestId: null, runId: null, trigger: null, createdAt: null, stuckAlertSent: false, lastRun: null } },
    create: { key: "sheetSyncRequest", value: { status: "idle", requestId: null, runId: null, trigger: null, createdAt: null, stuckAlertSent: false, lastRun: null } },
  });
}

async function main() {
  await setMode("SHEET_LIVE");
  await resetSheetSyncRequestState();
  // Idempotent test setup: a previous crashed run of this script can leave a
  // dangling IN_PROGRESS ImportRun behind (the real reaper only clears one
  // after 10 minutes) — clear any sheet-sync run left running before this
  // script's own tests start, same spirit as other tmp-e2e-*.ts scripts
  // deleting their own test user at the top before recreating it.
  await db.boqSyncStagingChunk.deleteMany({ where: { run: { status: "IN_PROGRESS" } } });
  await db.importRun.updateMany({
    where: { status: "IN_PROGRESS", trigger: { not: null } },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage: "cleared by tmp-e2e-sheet-sync.ts setup" },
  });

  await db.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.user.create({ data: { name: "Tmp E2E Sheet Sync Admin", email: ADMIN_EMAIL, role: "ADMIN", passwordHash } });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // --- Test 5: auth ---
    console.log("\n-- Test 5: auth --");
    const noSecret = await callSync("/api/sheet-sync/pending", undefined, {});
    check("no secret -> 401 on /pending", noSecret.status === 401);
    const wrongSecret = await callSync("/api/sheet-sync/pending", undefined, { secret: "wrong-secret-value" });
    check("wrong secret -> 401 on /pending", wrongSecret.status === 401);
    const noSecretStart = await callSync("/api/sheet-sync/start", { trigger: "button" }, {});
    check("no secret -> 401 on /start", noSecretStart.status === 401);
    const noSessionRequest = await fetch(`${BASE}/api/sheet-sync/request`, { method: "POST" });
    check("no admin session -> not 202 on /request", noSessionRequest.status !== 202);

    // --- Test 6: /request is retired (website is the source of truth) ---
    console.log("\n-- Test 6: /request retired --");
    await resetSheetSyncRequestState();
    const retired = await page.request.post(`${BASE}/api/sheet-sync/request`);
    check("admin POST /request -> 410 (no new sync can be queued)", retired.status() === 410);
    const pendingAfterRetired = await callSync("/api/sheet-sync/pending", undefined, { secret: SHEET_SYNC_SECRET });
    check("/pending sees nothing queued", (pendingAfterRetired.json as { pending: boolean }).pending === false);

    const payload = loadPayload();

    // --- Test 1 + 4 + 8 + 9: happy path, idempotent retry, duplicate names, rateMissing ---
    console.log("\n-- Test 1/4/8/9: happy path (with one retried chunk) --");
    const { finish: finish1 } = await runFullSync(payload, { retryFirstChunk: true });
    check("finish succeeds", finish1.ok);
    const counts1 = (finish1.json as { counts?: { items: number; siteItems: number; sites: number } }).counts;
    check(`item count matches expected (${payload.finish.expected.items})`, counts1?.items === payload.finish.expected.items);

    const dbItems = await db.item.count({ where: { isActive: true } });
    check(`DB active item count == ${payload.finish.expected.items} (retried chunk did not duplicate)`, dbItems === payload.finish.expected.items);

    const cocktailGlasses = await db.item.findMany({ where: { name: { equals: "Japanese Cocktail Glass", mode: "insensitive" } } });
    check("duplicate-name items (Japanese Cocktail Glass) stay as separate rows", cocktailGlasses.length === 3);

    const missingRateItemKey = payload.chunks.flatMap((c) => c.tab.items).find((i) => (i as { rateMissing?: boolean }).rateMissing)?.itemKey;
    if (missingRateItemKey) {
      const item = await db.item.findUnique({ where: { sourceKey: missingRateItemKey }, include: { vendorRates: true, finalVendor: true } });
      const finalVendorRate = item?.vendorRates.find((vr) => vr.vendorId === item.finalVendorId)?.rate ?? null;
      check(`rateMissing item "${missingRateItemKey}" has a null rate (renders "Rate pending")`, finalVendorRate === null);
    } else {
      check("found a rateMissing item in the sample to check", false);
    }

    const sitesActive = await db.site.count({ where: { usedInBoq: true } });
    check(`DB active site count == ${payload.finish.expected.sites}`, sitesActive === payload.finish.expected.sites);

    // --- Test 2: atomic — start + 10 chunks, then /fail ---
    console.log("\n-- Test 2: atomic fail --");
    const before2 = await snapshot();
    const start2 = await callSync("/api/sheet-sync/start", payload.start, { secret: SHEET_SYNC_SECRET });
    const runId2 = (start2.json as { runId: string }).runId;
    for (const chunk of payload.chunks.slice(0, 10)) {
      await callSync("/api/sheet-sync/chunk", { runId: runId2, tab: chunk.tab }, { secret: SHEET_SYNC_SECRET });
    }
    const fail2 = await callSync("/api/sheet-sync/fail", { runId: runId2, message: "e2e test: simulated script failure" }, { secret: SHEET_SYNC_SECRET });
    check("/fail accepted", fail2.ok);
    const after2 = await snapshot();
    check("live data unchanged after partial run + /fail", JSON.stringify(before2) === JSON.stringify(after2));
    const run2 = await db.importRun.findUnique({ where: { id: runId2 } });
    check("run marked FAILED", run2?.status === "FAILED");
    const staging2 = await db.boqSyncStagingChunk.count({ where: { runId: runId2 } });
    check("staging cleared for failed run", staging2 === 0);

    // --- Test 3: atomic — finish with wrong expected.items ---
    console.log("\n-- Test 3: atomic count mismatch --");
    const before3 = await snapshot();
    const { runId: runId3, finish: finish3 } = await runFullSync({ ...payload, finish: { expected: { ...payload.finish.expected, items: payload.finish.expected.items + 1 } } });
    check("finish with wrong expected.items is rejected", !finish3.ok);
    const after3 = await snapshot();
    check("live data unchanged after count-mismatch finish", JSON.stringify(before3) === JSON.stringify(after3));
    const run3 = await db.importRun.findUnique({ where: { id: runId3 } });
    check("mismatched run marked FAILED", run3?.status === "FAILED");

    // --- Test 7: a site removed from sites[] gets archived, not deleted ---
    console.log("\n-- Test 7: site removed from sites[] -> archived --");
    const removedSiteName = (payload.start.sites[0] as { name: string }).name;
    const siteBefore = await db.site.findFirst({ where: { name: { equals: removedSiteName, mode: "insensitive" } } });
    const siteItemsForSiteBefore = siteBefore ? await db.siteItem.count({ where: { siteId: siteBefore.id } }) : 0;
    check(`"${removedSiteName}" has tracked SiteItem rows before removal`, siteItemsForSiteBefore > 0);

    const payloadWithoutSite: Payload = {
      ...payload,
      start: { ...payload.start, sites: payload.start.sites.filter((s) => (s as { name: string }).name !== removedSiteName) },
      chunks: payload.chunks.map((c) => ({
        tab: {
          ...c.tab,
          items: c.tab.items.map((item) => ({
            ...item,
            sites: Object.fromEntries(Object.entries(item.sites).filter(([name]) => name !== removedSiteName)),
          })),
        },
      })),
      finish: { expected: { ...payload.finish.expected, sites: payload.finish.expected.sites - 1 } },
    };
    const { finish: finish7 } = await runFullSync(payloadWithoutSite);
    check("resync without the site succeeds", finish7.ok);

    const siteAfter = await db.site.findUnique({ where: { id: siteBefore!.id } });
    check(`"${removedSiteName}" still exists (not deleted)`, siteAfter !== null);
    check(`"${removedSiteName}" is archived (usedInBoq = false)`, siteAfter?.usedInBoq === false);
    const siteItemsForSiteAfter = await db.siteItem.count({ where: { siteId: siteBefore!.id } });
    check(`"${removedSiteName}"'s old SiteItem rows survive (frozen, not deleted)`, siteItemsForSiteAfter === siteItemsForSiteBefore);

    // --- UI: the "Sync with sheet" button is gone from /site-boq. ---
    console.log("\n-- UI: no Sync with sheet button --");
    await page.goto(`${BASE}/site-boq`);
    await page.waitForLoadState("networkidle");
    check("no 'Sync with sheet' button on /site-boq", (await page.getByRole("button", { name: "Sync with sheet" }).count()) === 0);
  } finally {
    await browser?.close();
  }

  await db.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  await resetSheetSyncRequestState();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
