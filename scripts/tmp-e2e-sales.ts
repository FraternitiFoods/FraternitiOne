import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * plan.md section 20A, build order step 2 — real-browser verification of
 * /sales, /sales/import and manual entry. Uses the app's existing
 * dev-seeded SALES/ADMIN accounts (prisma/seed.ts) for login, but creates
 * its own dedicated throwaway FRANCHISEE user (direct Prisma insert, same
 * precedent as scripts/tmp-e2e-otp-signing.ts's e2e-only users) rather than
 * reusing franchisee.demo@fraterniti.co.in — that seed account turned out to
 * already have an in-progress StoreOnboarding record from the section 17/19
 * e2e scripts (status "Franchisee Signed", not LOI_COMPLETE), which makes
 * (app)/layout.tsx redirect EVERY route for that user to /onboarding
 * regardless of any FranchiseProject also assigned to them directly — that
 * redirect is correct, pre-existing app behavior, not a sales bug, but it
 * means franchisee.demo isn't a safe account to borrow for an unrelated
 * direct-project test. A fresh throwaway user has no onboarding row at all,
 * so it isn't affected.
 *
 * One throwaway FranchiseProject is created through the UI (Admin -> New
 * Project) and deleted through the UI's own delete-project feature at the
 * end; the throwaway franchisee user is removed directly via Prisma.
 *
 * Cleanup discipline: the throwaway project's deletion is wrapped in its own
 * `finally`, independent of whether any verification step above it throws.
 * An earlier version of this script did NOT do this — it only closed the
 * browser in `finally` — and a thrown exception partway through (a selector
 * bug, then later the dev server itself being killed mid-run) left three
 * throwaway projects and 34 SalesDay rows behind in the dev DB across
 * repeated runs. See plan.md section 20A build log for the incident and the
 * cleanup. This version always attempts deletion if a project was created,
 * even when everything above it failed.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set in .env");

const THROWAWAY_BRAND = "Tulsi";
const THROWAWAY_LOCATION = "Verification Store (temp, section 20A e2e)";
const THROWAWAY_FRANCHISEE_EMAIL = "e2e-sales-franchisee@example.com";
const THROWAWAY_FRANCHISEE_PASSWORD = "E2eSalesTest123!";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

/** Creates the dedicated throwaway franchisee user (see module comment for why). */
async function createThrowawayFranchisee() {
  const passwordHash = await bcrypt.hash(THROWAWAY_FRANCHISEE_PASSWORD, 12);
  return db.user.create({
    data: {
      name: "E2E Sales Franchisee Temp",
      email: THROWAWAY_FRANCHISEE_EMAIL,
      role: "FRANCHISEE",
      department: "FRANCHISEE",
      passwordHash,
    },
  });
}

async function login(page: Page, email: string, password: string = DEV_PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /sign out/i }).first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 10000 });
}

/**
 * Deletes the throwaway project through the app's own delete-project
 * feature, regardless of whatever session/page state an earlier thrown
 * exception left behind — a fresh `goto("/login")` + submit always creates
 * a new session and overwrites the cookie (login/page.tsx has no
 * already-authenticated redirect guard), so this works whether the page was
 * mid-dialog, logged in as a different role, or anything else.
 */
async function cleanupThrowawayProject(page: Page, projectId: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill("tech@fraterniti.co.in");
  await page.getByLabel(/password/i).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });

  await page.goto(`${BASE}/projects/${projectId}`);
  await page.getByRole("button", { name: /^delete project$/i }).click();
  await page.waitForSelector("text=Type", { timeout: 5000 });
  await page.locator("#delete-project-confirm").fill(`Delete project: ${THROWAWAY_BRAND} ${THROWAWAY_LOCATION}`);
  await page.getByRole("button", { name: /^delete project$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes(`/projects/${projectId}`), { timeout: 10000 });
}

function csvLine(date: string, gross: number, net: number, orders: number): string {
  return `${date},${gross},${net},${orders}`;
}

// --- Build a synthetic sales CSV with known, hand-checkable totals ---------
const goodRows: { date: string; gross: number; net: number; orders: number }[] = [];
for (let d = 15; d <= 30; d++) {
  const date = `2026-09-${String(d).padStart(2, "0")}`;
  goodRows.push({ date, gross: 10000 + d * 10, net: 9000 + d * 10, orders: 50 + d });
}
goodRows.push({ date: "2026-10-01", gross: 20000, net: 18000, orders: 90 }); // "today"

const badRows = [
  { date: "2026-10-05", gross: 5000, net: 4000, orders: 10 }, // future
  { date: "2026-08-01", gross: -500, net: 400, orders: 5 }, // negative
  { date: "2026-08-02", gross: 1000, net: 1500, orders: 5 }, // net > gross
];

const csvContent = [
  "date,gross_sales,net_sales,orders",
  ...goodRows.map((r) => csvLine(r.date, r.gross, r.net, r.orders)),
  ...badRows.map((r) => csvLine(r.date, r.gross, r.net, r.orders)),
].join("\n");

function sumPaise<T extends Record<string, number>>(rows: T[], key: keyof T): number {
  return rows.reduce((t, r) => t + (r[key] as number) * 100, 0);
}

const sept = goodRows.filter((r) => r.date.startsWith("2026-09"));
const todayRow = goodRows.find((r) => r.date === "2026-10-01")!;
const yesterdayRow = goodRows.find((r) => r.date === "2026-09-30")!;

const expected = {
  today: { net: todayRow.net * 100 },
  yesterday: { net: yesterdayRow.net * 100 },
  thisMonth: { net: todayRow.net * 100 }, // only the Oct row
  lastMonth: { net: sumPaise(sept, "net") },
  thisYear: { net: sumPaise(goodRows, "net") },
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

async function runVerification(
  page: Page,
  browser: import("@playwright/test").Browser,
  admin: { name: string },
  franchisee: { name: string },
  otherProjectId: string
) {
  // -----------------------------------------------------------------
  // 1. Admin creates a throwaway project through the real UI.
  // -----------------------------------------------------------------
  await login(page, "tech@fraterniti.co.in");
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Brand").fill(THROWAWAY_BRAND);
  await page.getByLabel("Format").fill("QSR");
  await page.getByLabel("Location").fill(THROWAWAY_LOCATION);
  await page.getByLabel("Franchisee").click();
  await page.getByRole("option", { name: new RegExp(franchisee.name) }).click();
  await page.getByLabel("Owner").click();
  await page.getByRole("option", { name: new RegExp(admin.name) }).click();
  await page.getByLabel("Target Opening").fill("2027-06-01");
  await page.getByRole("button", { name: /create project/i }).click();
  await page.waitForURL((url) => /^\/projects\/[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith("/new"), {
    timeout: 10000,
  });
  const throwawayProjectId = page.url().split("/projects/")[1];
  check("throwaway project created", Boolean(throwawayProjectId));
  console.log("    throwaway project id:", throwawayProjectId);

  try {
    // -----------------------------------------------------------------
    // 2. Empty state before any sales data.
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/sales?project=${throwawayProjectId}`);
    check("empty state shown before import", await page.getByText("No sales recorded yet.").isVisible());

    // -----------------------------------------------------------------
    // 3. Import — dry run preview, then confirm.
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/sales/import?project=${throwawayProjectId}`);
    await page.setInputFiles("#sales-import-file", {
      name: "sales-e2e.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent, "utf-8"),
    });
    await page.getByRole("button", { name: /preview import/i }).click();
    await page.waitForSelector("text=Review before confirming", { timeout: 10000 });
    const previewText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check("preview shows a rejected count", previewText.includes("Rejected"));
    check("preview lists future-date rejection", previewText.toLowerCase().includes("future date"));
    check("preview lists negative-amount rejection", previewText.toLowerCase().includes("cannot be negative"));
    check("preview lists net>gross rejection", previewText.toLowerCase().includes("cannot exceed gross"));

    await page.getByRole("button", { name: /confirm import/i }).click();
    await page.waitForSelector("text=Import confirmed.", { timeout: 15000 });
    const confirmText = await page.locator("body").innerText();
    check(
      "confirm shows 17 inserted / 0 changed / 3 rejected",
      /17 new day\(s\), 0 changed day\(s\), 3 row\(s\) rejected/.test(confirmText)
    );

    const afterFirstImport = await db.salesDay.count({ where: { projectId: throwawayProjectId } });
    check("17 SalesDay rows exist after first import", afterFirstImport === 17);

    // -----------------------------------------------------------------
    // 4. Totals on /sales match a hand calculation (computed independently
    //    in this script from the same source CSV values, not read back from
    //    the app's own aggregation code).
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/sales?project=${throwawayProjectId}`);
    const salesPageText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check("Today net sales matches hand calc", salesPageText.includes(rupees(expected.today.net)));
    check("Yesterday net sales matches hand calc", salesPageText.includes(rupees(expected.yesterday.net)));
    check("This Month net sales matches hand calc", salesPageText.includes(rupees(expected.thisMonth.net)));
    check("Last Month net sales matches hand calc", salesPageText.includes(rupees(expected.lastMonth.net)));
    check("This Year net sales matches hand calc", salesPageText.includes(rupees(expected.thisYear.net)));

    // -----------------------------------------------------------------
    // 5. Re-import the exact same file -> idempotent (no duplicates, all unchanged).
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/sales/import?project=${throwawayProjectId}`);
    await page.setInputFiles("#sales-import-file", {
      name: "sales-e2e.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent, "utf-8"),
    });
    await page.getByRole("button", { name: /preview import/i }).click();
    await page.waitForSelector("text=Review before confirming", { timeout: 10000 });
    await page.getByRole("button", { name: /confirm import/i }).click();
    await page.waitForSelector("text=Import confirmed.", { timeout: 15000 });
    const reImportText = await page.locator("body").innerText();
    check(
      "re-import inserts 0 new, updates 0 — fully idempotent",
      /0 new day\(s\), 0 changed day\(s\), 3 row\(s\) rejected/.test(reImportText)
    );

    const afterSecondImport = await db.salesDay.count({ where: { projectId: throwawayProjectId } });
    check("still exactly 17 SalesDay rows after re-import (no duplicates)", afterSecondImport === 17);

    await page.goto(`${BASE}/sales?project=${throwawayProjectId}`);
    const salesPageTextAfterReimport = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check("totals unchanged after re-import", salesPageTextAfterReimport.includes(rupees(expected.thisYear.net)));

    // -----------------------------------------------------------------
    // 6. Manual edit of one day -> old value captured in the audit trail.
    // -----------------------------------------------------------------
    const beforeEdit = await db.salesDay.findFirstOrThrow({
      where: { projectId: throwawayProjectId, date: new Date("2026-10-01T00:00:00.000Z") },
    });
    await page.goto(`${BASE}/sales?project=${throwawayProjectId}`);
    await page.getByRole("button", { name: /^edit$/i }).first().click();
    await page.waitForSelector("text=Edit sales day");
    await page.locator("#sales-gross").fill("99999");
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForSelector("text=Edit sales day", { state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForLoadState("networkidle");

    const afterEditEvent = await db.auditEvent.findFirst({
      where: { projectId: throwawayProjectId, entityType: "SalesDay", action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    check("audit event exists for the manual edit", Boolean(afterEditEvent));
    check(
      "audit event's oldValue carries the pre-edit gross amount",
      (afterEditEvent?.oldValue as { grossSales?: number } | null)?.grossSales === beforeEdit.grossSales
    );
    check(
      "audit event's newValue carries the new gross amount (9999900 paise)",
      (afterEditEvent?.newValue as { grossSales?: number } | null)?.grossSales === 9999900
    );

    // -----------------------------------------------------------------
    // 7. Franchisee isolation.
    // -----------------------------------------------------------------
    await logout(page);
    await login(page, THROWAWAY_FRANCHISEE_EMAIL, THROWAWAY_FRANCHISEE_PASSWORD);
    await page.goto(`${BASE}/sales`);
    const franchiseeOwnText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check("franchisee lands directly on their own store's sales", franchiseeOwnText.includes("Verification Store"));
    check("franchisee view has no Import/Add-a-day controls", !franchiseeOwnText.includes("Add a day"));

    const blockedResp1 = await page.goto(`${BASE}/sales?project=${otherProjectId}`);
    const blockedText1 = await page.locator("body").innerText();
    check(
      "franchisee blocked (404) from a store that isn't theirs, by URL",
      blockedResp1?.status() === 404 || /could not be found/i.test(blockedText1)
    );

    const importBlockedResp = await page.goto(`${BASE}/sales/import?project=${throwawayProjectId}`);
    check(
      "franchisee bounced off /sales/import (Admin only)",
      page.url().includes("/dashboard") || importBlockedResp?.status() === 404
    );

    // -----------------------------------------------------------------
    // 8. SALES isolation — sales.demo owns no stores (no onboarding link).
    // -----------------------------------------------------------------
    await logout(page);
    await login(page, "sales.demo@fraterniti.co.in");
    await page.goto(`${BASE}/sales`);
    const salesEmptyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(
      "unassigned SALES user sees 'no stores assigned' (owns nothing)",
      salesEmptyText.toLowerCase().includes("no stores assigned")
    );

    const salesBlocked1 = await page.goto(`${BASE}/sales?project=${throwawayProjectId}`);
    const salesBlockedText1 = await page.locator("body").innerText();
    check(
      "SALES user blocked (404) from the throwaway store by URL",
      salesBlocked1?.status() === 404 || /could not be found/i.test(salesBlockedText1)
    );

    const salesBlocked2 = await page.goto(`${BASE}/sales?project=${otherProjectId}`);
    const salesBlockedText2 = await page.locator("body").innerText();
    check(
      "SALES user blocked (404) from the real Junagadh store by URL",
      salesBlocked2?.status() === 404 || /could not be found/i.test(salesBlockedText2)
    );

    await page.goto(`${BASE}/sales/import?project=${throwawayProjectId}`);
    check("SALES user bounced off /sales/import (Admin only)", page.url().includes("/dashboard"));
  } finally {
    // Always attempt cleanup, whatever happened above — this is the fix for
    // the leftover-data incident (see module comment). Uses a brand-new page
    // (not the one the whole run drove) — `page.goto("/login")` after a long
    // run on the original page was observed to hang waiting for the email
    // field, even though the same navigation+login sequence works fine from
    // a fresh page; a new page sidesteps whatever residual state that was.
    const cleanupPage = await browser.newPage();
    try {
      await cleanupThrowawayProject(cleanupPage, throwawayProjectId);
      const projectStillExists = await db.franchiseProject.findUnique({ where: { id: throwawayProjectId } });
      check("throwaway project deleted", projectStillExists === null);
      const salesDaysAfterDelete = await db.salesDay.count({ where: { projectId: throwawayProjectId } });
      check("SalesDay rows cascade-deleted with the project", salesDaysAfterDelete === 0);
      const batchesAfterDelete = await db.salesImportBatch.count({ where: { projectId: throwawayProjectId } });
      check("SalesImportBatch rows cascade-deleted with the project", batchesAfterDelete === 0);
    } catch (cleanupError) {
      console.error("CLEANUP FAILED — a throwaway project may be left behind:", cleanupError);
      failures++;
    } finally {
      await cleanupPage.close();
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Clean up any stale throwaway franchisee from a previous interrupted run
  // before creating a fresh one — db.user.create would otherwise fail on the
  // unique email constraint.
  await db.user.deleteMany({ where: { email: THROWAWAY_FRANCHISEE_EMAIL } });
  const franchisee = await createThrowawayFranchisee();

  try {
    try {
      const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });
      const otherProject = await db.franchiseProject.findFirstOrThrow({ select: { id: true } }); // FR-00018 (Junagadh)

      await runVerification(page, browser, admin, franchisee, otherProject.id);
    } finally {
      await browser.close();
    }
  } finally {
    await db.user.delete({ where: { id: franchisee.id } }).catch((e) => {
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
