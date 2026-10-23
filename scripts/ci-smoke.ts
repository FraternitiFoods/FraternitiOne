import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LIFECYCLE_STAGE_ORDER } from "@/lib/format";
import { STAGE_TASK_TEMPLATES } from "@/lib/lifecycle-stage-tasks";
import { OPS_PROGRESS_TASK_TEMPLATES } from "@/lib/ops-progress-tasks";

/**
 * CI smoke suite — run in `.github/workflows/ci.yml`'s `e2e` job against a
 * throwaway Postgres service container + `pnpm dev`, never against the real
 * dev DB. Deliberately scoped to flows that need no B2/Resend/Leegality/
 * Cloudmersive credentials (none of those are available as CI secrets today):
 * login, task creation + the status choke point's evidence-required rule
 * (plan.md section 27D), the audit trail, franchisee project isolation, and
 * sales CSV import (idempotent re-import + franchisee/other-store isolation
 * — plan.md section 20A never needed B2 for this path either). LOI/KYC/
 * mobile-upload/Petpooja/document-vault flows are NOT covered here — they
 * need file storage and are each already covered by their own
 * `scripts/tmp-e2e-*.ts`, run manually against a real dev DB with real
 * credentials, not in CI.
 *
 * Same conventions as scripts/tmp-e2e-sales.ts: a `check()` tally, dedicated
 * throwaway users (never the shared *.demo@ seed accounts — franchisee.demo@
 * in particular can carry an in-progress StoreOnboarding from other e2e
 * scripts, which would redirect every route for that user to /onboarding),
 * and cleanup wrapped in `finally` so a thrown assertion never leaves data
 * behind.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");

const BRAND = "CI Smoke";
const LOCATION_A = "Store A (ci-smoke)";
const LOCATION_B = "Store B (ci-smoke)";
const FRANCHISEE_A_EMAIL = "ci-smoke-franchisee-a@example.com";
const FRANCHISEE_B_EMAIL = "ci-smoke-franchisee-b@example.com";
const THROWAWAY_PASSWORD = "CiSmokeTest123!";
const TASK_TITLE = "CI Smoke Task";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function createThrowawayFranchisee(email: string, name: string) {
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  return db.user.create({
    data: { name, email, role: "FRANCHISEE", department: "FRANCHISEE", passwordHash },
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

async function createThrowawayProject(page: Page, location: string, franchiseeName: string, adminName: string) {
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Brand").fill(BRAND);
  await page.getByLabel("Format").fill("QSR");
  await page.getByLabel("Location").fill(location);
  await page.getByLabel("Franchisee").click();
  await page.getByRole("option", { name: new RegExp(franchiseeName) }).click();
  await page.getByLabel("Owner").click();
  await page.getByRole("option", { name: new RegExp(adminName) }).click();
  await page.getByLabel(/already operational/i).check();
  await page.getByLabel("Target Opening").fill("2027-06-01");
  await page.getByRole("button", { name: /create project/i }).click();
  await page.waitForURL((url) => /\/projects\/[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith("/new"), {
    timeout: 10000,
  });
  return page.url().split("/projects/")[1];
}

async function deleteThrowawayProject(page: Page, projectId: string, location: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill("tech@fraterniti.co.in");
  await page.getByLabel(/password/i).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });

  await page.goto(`${BASE}/projects/${projectId}`);
  await page.getByRole("button", { name: /^delete project$/i }).click();
  await page.waitForSelector("text=Type", { timeout: 5000 });
  await page.locator("#delete-project-confirm").fill(`Delete project: ${BRAND} ${location}`);
  await page.getByRole("button", { name: /^delete project$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes(`/projects/${projectId}`), { timeout: 10000 });
}

/**
 * Polls the DB directly rather than a UI selector — a Select showing
 * "Completed" is true the instant an option is clicked, before the form is
 * even submitted, so waiting for that text in the DOM proves nothing about
 * whether the server action actually ran. Same class of timing gap plan.md
 * section 24 S1's own build log hit with this exact form.
 */
async function waitForTaskStatus(taskId: string, status: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.status === status) return task;
    await new Promise((r) => setTimeout(r, 250));
  }
  return db.task.findUniqueOrThrow({ where: { id: taskId } });
}

async function runTaskAndAuditChecks(page: Page, projectId: string) {
  // ---- Create a task (plan.md section 27D: Admin-only create). ----
  await page.goto(`${BASE}/projects/${projectId}`);
  await page.getByLabel("Title").fill(TASK_TITLE);
  await page.getByLabel("Module").click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Stage").click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Owner").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: /^add task$/i }).click();
  await page.waitForSelector(`text=${TASK_TITLE}`, { timeout: 10000 });

  const task = await db.task.findFirstOrThrow({ where: { projectId, title: TASK_TITLE } });
  check("task created via the UI", Boolean(task));

  const card = page.locator(`#task-${task.id}`);
  await card.getByRole("button", { name: /update status/i }).click();

  // ---- Evidence-required rule (plan.md section 27D, 2026-10-17). ----
  await card.getByRole("combobox").click();
  await page.getByRole("option", { name: "Completed" }).click();
  await card.getByRole("button", { name: /update status/i }).click();
  await page.waitForSelector("text=Add completion evidence", { timeout: 10000 });
  const stillNotStarted = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  check(
    "completing without evidence is rejected server-side, not just hidden in the UI",
    stillNotStarted.status !== "COMPLETED"
  );

  // ---- Same transition, now with evidence -> succeeds. ----
  await card.getByPlaceholder(/completion evidence/i).fill("Verified during CI smoke run.");
  await card.getByRole("combobox").click();
  await page.getByRole("option", { name: "Completed" }).click();
  await card.getByRole("button", { name: /update status/i }).click();
  const completed = await waitForTaskStatus(task.id, "COMPLETED");
  check("task reaches COMPLETED once evidence is supplied", completed.status === "COMPLETED");
  check("startedAt was stamped by the status choke point", completed.startedAt !== null);
  check("completedAt was stamped by the status choke point", completed.completedAt !== null);

  // ---- Audit trail (FR-010) — checked at the DB layer, not by parsing /audit. ----
  const auditEvents = await db.auditEvent.findMany({
    where: { projectId, entityType: "Task", entityId: task.id },
    orderBy: { createdAt: "asc" },
  });
  check("task CREATE wrote an audit event", auditEvents.some((e) => e.action === "CREATE"));
  check(
    "a rejected (no-evidence) attempt did not write a spurious COMPLETED audit event",
    !auditEvents.some(
      (e) => e.action === "UPDATE" && (e.newValue as { status?: string } | null)?.status === "COMPLETED" && e.createdAt < completed.completedAt!
    )
  );
  check(
    "the real completion wrote an UPDATE audit event with the correct old -> new status",
    auditEvents.some(
      (e) =>
        e.action === "UPDATE" &&
        (e.oldValue as { status?: string } | null)?.status === "NOT_STARTED" &&
        (e.newValue as { status?: string } | null)?.status === "COMPLETED"
    )
  );
}

function csvLine(date: string, gross: number, net: number, orders: number): string {
  return `${date},${gross},${net},${orders}`;
}

async function runSalesChecks(page: Page, projectId: string, otherProjectId: string) {
  const rows = [
    { date: "2026-10-01", gross: 10000, net: 9000, orders: 10 },
    { date: "2026-10-02", gross: 12000, net: 10500, orders: 12 },
    { date: "2026-10-03", gross: 8000, net: 7200, orders: 8 },
  ];
  const csvContent = ["date,gross_sales,net_sales,orders", ...rows.map((r) => csvLine(r.date, r.gross, r.net, r.orders))].join(
    "\n"
  );
  const expectedNetPaise = rows.reduce((t, r) => t + r.net * 100, 0);

  await page.goto(`${BASE}/sales/import?project=${projectId}`);
  await page.setInputFiles("#sales-import-file", {
    name: "ci-smoke-sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvContent, "utf-8"),
  });
  await page.getByRole("button", { name: /preview import/i }).click();
  await page.waitForSelector("text=Review before confirming", { timeout: 10000 });
  await page.getByRole("button", { name: /confirm import/i }).click();
  await page.waitForSelector("text=Import confirmed.", { timeout: 15000 });

  const afterFirst = await db.salesDay.count({ where: { projectId } });
  check("3 SalesDay rows created by the import", afterFirst === 3);

  const yearTotal = await db.salesDay.aggregate({ where: { projectId }, _sum: { netSales: true } });
  check("SalesDay totals match a hand calculation", yearTotal._sum.netSales === expectedNetPaise);

  // ---- Idempotent re-import. ----
  await page.goto(`${BASE}/sales/import?project=${projectId}`);
  await page.setInputFiles("#sales-import-file", {
    name: "ci-smoke-sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvContent, "utf-8"),
  });
  await page.getByRole("button", { name: /preview import/i }).click();
  await page.waitForSelector("text=Review before confirming", { timeout: 10000 });
  await page.getByRole("button", { name: /confirm import/i }).click();
  await page.waitForSelector("text=Import confirmed.", { timeout: 15000 });
  const afterSecond = await db.salesDay.count({ where: { projectId } });
  check("re-importing the same file does not duplicate rows", afterSecond === 3);

  // ---- Isolation: Admin blocked from nothing, but a franchisee sees only their own store. ----
  const blocked = await page.goto(`${BASE}/sales?project=${otherProjectId}`);
  check("even Admin's own view respects ?project= scoping (no crash)", (blocked?.status() ?? 200) < 500);
}

const EXPECTED_SEED_TASK_COUNT =
  LIFECYCLE_STAGE_ORDER.reduce((sum, stage) => sum + STAGE_TASK_TEMPLATES[stage].length, 0) +
  OPS_PROGRESS_TASK_TEMPLATES.length;

/**
 * `toggleReclassify` navigates to the project page it's about to assert
 * against, so a `waitForURL` check for that same pathname is trivially true
 * from the instant we land there — it proves nothing about whether the
 * dialog's submit actually completed. Same class of bug plan.md section
 * 24 S1 hit with this exact form shape. Poll the DB for the real outcome
 * instead, same fix already applied to `waitForTaskStatus` above.
 */
async function waitForProjectIsPreExisting(projectId: string, expected: boolean, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const project = await db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
    if (project.isPreExisting === expected) return project;
    await new Promise((r) => setTimeout(r, 250));
  }
  return db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
}

async function toggleReclassify(page: Page, projectId: string, buttonName: RegExp, expectedIsPreExisting: boolean) {
  const resp = await page.goto(`${BASE}/projects/${projectId}`);
  try {
    await page.getByRole("button", { name: buttonName }).click({ timeout: 10000 });
  } catch (e) {
    console.log("DEBUG toggleReclassify trigger-click failed. status:", resp?.status(), "url:", page.url());
    console.log("DEBUG body (first 500 chars):", (await page.locator("body").innerText()).slice(0, 500));
    throw e;
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: buttonName }).click();
  await waitForProjectIsPreExisting(projectId, expectedIsPreExisting);
}

/**
 * Covers the gap plan.md section 23 left open: isPreExisting was only
 * settable at project-creation time. Exercises both directions and both
 * safety properties — reclassifying never deletes existing tasks, and never
 * double-seeds a project that already has some.
 */
async function runReclassifyChecks(page: Page, projectIdA: string, projectIdB: string) {
  // Project B: created with skipSeeding (isPreExisting=true, 0 tasks) — the
  // "undo my mistake" path should seed the standard checklist now.
  await toggleReclassify(page, projectIdB, /mark as build-out project/i, false);
  const projectB = await db.franchiseProject.findUniqueOrThrow({
    where: { id: projectIdB },
    select: { isPreExisting: true, _count: { select: { tasks: true } } },
  });
  check("reclassifying B to build-out flips isPreExisting to false", projectB.isPreExisting === false);
  check(
    `reclassifying B seeded the standard checklist (${EXPECTED_SEED_TASK_COUNT} tasks)`,
    projectB._count.tasks === EXPECTED_SEED_TASK_COUNT
  );
  const seedAudit = await db.auditEvent.findFirst({
    where: { projectId: projectIdB, entityType: "FranchiseProject", action: "UPDATE", reference: { contains: "seeded" } },
  });
  check("an audit event records the reclassify + seed", Boolean(seedAudit));

  // Project A: created the same way as B (skip-seeding checked, isPreExisting
  // starts true), then picked up exactly 1 task via the "Add a task" form in
  // runTaskAndAuditChecks — not via seeding. Toggling to build-out must NOT
  // seed on top of that 1 task (task count isn't 0); toggling back must not
  // delete it either.
  await toggleReclassify(page, projectIdA, /mark as build-out project/i, false);
  const projectABuildOut = await db.franchiseProject.findUniqueOrThrow({
    where: { id: projectIdA },
    select: { isPreExisting: true, _count: { select: { tasks: true } } },
  });
  check("reclassifying A to build-out flips isPreExisting to false", projectABuildOut.isPreExisting === false);
  check(
    "reclassifying A to build-out does not double-seed (still has exactly 1 task)",
    projectABuildOut._count.tasks === 1
  );

  await toggleReclassify(page, projectIdA, /mark as already operational/i, true);
  const projectAPreExisting = await db.franchiseProject.findUniqueOrThrow({
    where: { id: projectIdA },
    select: { isPreExisting: true, _count: { select: { tasks: true } } },
  });
  check("reclassifying A back to pre-existing flips isPreExisting to true", projectAPreExisting.isPreExisting === true);
  check("reclassifying A back to pre-existing does not delete its existing task", projectAPreExisting._count.tasks === 1);
}

async function runIsolationChecks(page: Page, projectIdA: string, projectIdB: string) {
  await logout(page);
  await login(page, FRANCHISEE_A_EMAIL, THROWAWAY_PASSWORD);

  await page.goto(`${BASE}/dashboard`);
  await page.waitForLoadState("networkidle");
  const ownText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("franchisee A's dashboard mentions their own store", ownText.includes(LOCATION_A));

  // `waitForLoadState("networkidle")` matters here: the initial HTML can be
  // a still-streaming Suspense/loading shell, not the resolved not-found
  // response — reading the body before it settles reads the wrong content.
  const blockedProject = await page.goto(`${BASE}/projects/${projectIdB}`);
  await page.waitForLoadState("networkidle");
  const blockedProjectText = await page.locator("body").innerText();
  const blockedProjectOk = blockedProject?.status() === 404 || /could not be found/i.test(blockedProjectText);
  if (!blockedProjectOk) {
    console.log("DEBUG blockedProject status:", blockedProject?.status(), "page.url:", page.url());
    console.log("DEBUG blockedProject body (first 300 chars):", blockedProjectText.slice(0, 300));
  }
  check("franchisee A cannot open franchisee B's project by URL", blockedProjectOk);

  const blockedSales = await page.goto(`${BASE}/sales?project=${projectIdB}`);
  await page.waitForLoadState("networkidle");
  check(
    "franchisee A cannot see franchisee B's sales by URL",
    blockedSales?.status() === 404 || /could not be found/i.test(await page.locator("body").innerText())
  );
}

async function main() {
  // Defensive: a prior interrupted run may have left its throwaway project(s)
  // behind, which would make deleting the franchisee below violate
  // FranchiseProject's FK. Clear projects first, then users.
  await db.franchiseProject.deleteMany({ where: { brand: BRAND } });
  await db.user.deleteMany({ where: { email: { in: [FRANCHISEE_A_EMAIL, FRANCHISEE_B_EMAIL] } } });
  const franchiseeA = await createThrowawayFranchisee(FRANCHISEE_A_EMAIL, "CI Smoke Franchisee A");
  const franchiseeB = await createThrowawayFranchisee(FRANCHISEE_B_EMAIL, "CI Smoke Franchisee B");
  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });

  const browser: Browser = await chromium.launch();
  const page = await browser.newPage();
  let projectIdA: string | undefined;
  let projectIdB: string | undefined;

  // A `finally` block that itself throws replaces/swallows whatever error
  // the `try` block threw — the real failure would otherwise never be seen.
  // So: catch and log the verification error explicitly, run every cleanup
  // step independently (one failing must not skip the others), and never let
  // cleanup itself throw past this function.
  try {
    await login(page, "tech@fraterniti.co.in");

    projectIdA = await createThrowawayProject(page, LOCATION_A, franchiseeA.name, admin.name);
    check("throwaway project A created", Boolean(projectIdA));
    projectIdB = await createThrowawayProject(page, LOCATION_B, franchiseeB.name, admin.name);
    check("throwaway project B created", Boolean(projectIdB));

    await runTaskAndAuditChecks(page, projectIdA);
    await runSalesChecks(page, projectIdA, projectIdB);
    await runReclassifyChecks(page, projectIdA, projectIdB);
    await runIsolationChecks(page, projectIdA, projectIdB);
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    // A fresh page (new, isolated browser context) per deletion, not one
    // page reused across both — a page that just finished one authenticated
    // flow and is then sent back to /login for a second one is not the same
    // as a cookie-free start, and this hit exactly that: the second call's
    // `goto("/login")` never showed the email field.
    if (projectIdA) {
      const cleanupPageA = await browser.newPage();
      try {
        await deleteThrowawayProject(cleanupPageA, projectIdA, LOCATION_A);
        check("project A deleted", (await db.franchiseProject.findUnique({ where: { id: projectIdA } })) === null);
      } catch (cleanupError) {
        console.error("CLEANUP FAILED for project A — it may be left behind:", cleanupError);
        failures++;
      } finally {
        await cleanupPageA.close();
      }
    }
    if (projectIdB) {
      const cleanupPageB = await browser.newPage();
      try {
        await deleteThrowawayProject(cleanupPageB, projectIdB, LOCATION_B);
        check("project B deleted", (await db.franchiseProject.findUnique({ where: { id: projectIdB } })) === null);
      } catch (cleanupError) {
        console.error("CLEANUP FAILED for project B — it may be left behind:", cleanupError);
        failures++;
      } finally {
        await cleanupPageB.close();
      }
    }
    await browser.close();
    await db.user.deleteMany({ where: { email: { in: [FRANCHISEE_A_EMAIL, FRANCHISEE_B_EMAIL] } } }).catch((e) => {
      console.error("Failed to delete throwaway franchisee users:", e);
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
