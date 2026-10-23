import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * plan.md section 23 NOT DECIDED #2 — real-browser verification of the
 * "reclassify project" button (src/app/(app)/projects/[id]/reclassify-project-button.tsx,
 * action in projects/actions.ts). Creates one throwaway project through the
 * real UI (as a normal build-out, so it gets the full seeded checklist),
 * then exercises both directions of the flip through the actual button:
 *
 *   build-out (isPreExisting=false, ~963 tasks) --flip--> already operational
 *     --flip--> build-out again (0 tasks now, since nothing was seeded while
 *     the first branch's seed existed) --flip--> already operational again
 *
 * Mirrors tmp-e2e-sales.ts's cleanup discipline: project deletion happens in
 * a `finally`, through the app's own delete-project feature, regardless of
 * where an earlier check failed.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set in .env");

const THROWAWAY_BRAND = "Tulsi";
const THROWAWAY_LOCATION = "Reclassify Verification Store (temp, section 23 e2e)";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function login(page: Page, email: string, password: string = DEV_PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

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

async function runVerification(
  page: Page,
  browser: import("@playwright/test").Browser,
  admin: { name: string; id: string },
  franchiseeName: string
) {
  // -----------------------------------------------------------------
  // 1. Admin creates a throwaway project through the real UI, as a normal
  //    build-out (not pre-existing) so it gets the full seeded checklist.
  // -----------------------------------------------------------------
  await login(page, "tech@fraterniti.co.in");
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Brand").fill(THROWAWAY_BRAND);
  await page.getByLabel("Format").fill("QSR");
  await page.getByLabel("Location").fill(THROWAWAY_LOCATION);
  await page.getByLabel("Franchisee").click();
  await page.getByRole("option", { name: new RegExp(franchiseeName) }).click();
  await page.getByLabel("Owner").click();
  await page.getByRole("option", { name: new RegExp(admin.name) }).click();
  await page.getByLabel("Target Opening").fill("2027-06-01");
  await page.getByRole("button", { name: /create project/i }).click();
  await page.waitForURL((url) => /^\/projects\/[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith("/new"), {
    timeout: 10000,
  });
  const projectId = page.url().split("/projects/")[1];
  check("throwaway project created", Boolean(projectId));
  console.log("    throwaway project id:", projectId);

  try {
    const initialTaskCount = await db.task.count({ where: { projectId } });
    check("build-out project seeded ~963 tasks", initialTaskCount > 900);

    const initialProject = await db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
    check("project starts isPreExisting=false", initialProject.isPreExisting === false);

    // -----------------------------------------------------------------
    // 2. Flip #1: build-out -> already operational. Tasks must survive.
    //
    // Deliberately NOT waiting on page.waitForURL here: the server action
    // redirects back to this exact same /projects/[id] URL, so waitForURL
    // resolves the instant it's called (the path already matches) rather
    // than waiting for the mutation's re-render — a classic same-path-
    // redirect race. Waiting for the button's own label to flip to the
    // *opposite* text is what actually proves the server mutation (and the
    // RSC re-render reading the fresh DB row) has landed.
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/projects/${projectId}`);
    await page.getByRole("button", { name: /^mark as already operational$/i }).first().click();
    await page.waitForSelector("text=This does NOT delete", { timeout: 5000 });
    await page.getByRole("button", { name: /^mark as already operational$/i }).last().click();
    await page.getByRole("button", { name: /^mark as build-out project$/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });

    const afterFlip1 = await db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
    check("flip #1: isPreExisting is now true", afterFlip1.isPreExisting === true);
    const tasksAfterFlip1 = await db.task.count({ where: { projectId } });
    check("flip #1: existing tasks were not deleted", tasksAfterFlip1 === initialTaskCount);

    const auditFlip1 = await db.auditEvent.findFirst({
      where: { projectId, entityType: "FranchiseProject", action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    check("flip #1: audit event recorded", Boolean(auditFlip1));
    check(
      "flip #1: audit oldValue/newValue capture the isPreExisting transition",
      (auditFlip1?.oldValue as { isPreExisting?: boolean } | null)?.isPreExisting === false &&
        (auditFlip1?.newValue as { isPreExisting?: boolean } | null)?.isPreExisting === true
    );

    // Dashboard should now show the legacy (operational) home, not the
    // build-out tracker, for a franchisee on this project.
    await page.goto(`${BASE}/dashboard`);
    const dashAfterFlip1 = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(
      "flip #1: admin dashboard unaffected (admin sees portfolio view, not a single-project home)",
      !dashAfterFlip1.toLowerCase().includes("site progress")
    );

    // -----------------------------------------------------------------
    // 3. Flip #2: already operational -> build-out again. Project had tasks
    //    the whole time, so re-seeding must NOT happen (no double-seed).
    // -----------------------------------------------------------------
    await page.goto(`${BASE}/projects/${projectId}`);
    await page.getByRole("button", { name: /^mark as build-out project$/i }).first().click();
    await page.waitForSelector("text=already has", { timeout: 5000 });
    await page.getByRole("button", { name: /^mark as build-out project$/i }).last().click();
    await page.getByRole("button", { name: /^mark as already operational$/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });

    const afterFlip2 = await db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
    check("flip #2: isPreExisting is false again", afterFlip2.isPreExisting === false);
    const tasksAfterFlip2 = await db.task.count({ where: { projectId } });
    check("flip #2: no double-seed — task count unchanged", tasksAfterFlip2 === initialTaskCount);

    // -----------------------------------------------------------------
    // 4. Flip #3: delete all tasks directly, then flip to operational and
    //    back to build-out — THIS time it should re-seed from zero.
    // -----------------------------------------------------------------
    await db.task.deleteMany({ where: { projectId } });
    const zeroTasks = await db.task.count({ where: { projectId } });
    check("setup: all tasks removed directly for the re-seed test", zeroTasks === 0);

    await page.goto(`${BASE}/projects/${projectId}`);
    await page.getByRole("button", { name: /^mark as already operational$/i }).first().click();
    await page.waitForSelector("text=This does NOT delete", { timeout: 5000 });
    await page.getByRole("button", { name: /^mark as already operational$/i }).last().click();
    await page.getByRole("button", { name: /^mark as build-out project$/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });

    await page.goto(`${BASE}/projects/${projectId}`);
    await page.getByRole("button", { name: /^mark as build-out project$/i }).first().click();
    await page.waitForSelector("text=standard build-out checklist", { timeout: 5000 });
    await page.getByRole("button", { name: /^mark as build-out project$/i }).last().click();
    await page.getByRole("button", { name: /^mark as already operational$/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });

    const afterReseed = await db.franchiseProject.findUniqueOrThrow({ where: { id: projectId } });
    check("flip #3: isPreExisting is false again", afterReseed.isPreExisting === false);
    const tasksAfterReseed = await db.task.count({ where: { projectId } });
    check("flip #3: zero-task project gets re-seeded ~963 tasks", tasksAfterReseed > 900);

    // -----------------------------------------------------------------
    // 5. Permission check — a non-Admin role must not see the button at all.
    //
    // Fresh page, not the one that drove flips #1-#3: tmp-e2e-sales.ts hit
    // (and documented) the same thing — reusing one page across a long run
    // of navigations can leave it in a state where a plain goto("/login")
    // hangs waiting for the email field, even though the identical
    // navigation+fill works instantly from a brand-new page. Same fix here.
    // -----------------------------------------------------------------
    const salesPage = await browser.newPage();
    try {
      await login(salesPage, "sales.demo@fraterniti.co.in");
      await salesPage.goto(`${BASE}/projects/${projectId}`);
      const salesViewText = (await salesPage.locator("body").innerText()).replace(/\s+/g, " ");
      check(
        "non-Admin (SALES) does not see the reclassify button",
        !salesViewText.toLowerCase().includes("mark as already operational") &&
          !salesViewText.toLowerCase().includes("mark as build-out project")
      );
    } finally {
      await salesPage.close();
    }
  } finally {
    const cleanupPage = await browser.newPage();
    try {
      await cleanupThrowawayProject(cleanupPage, projectId);
      const projectStillExists = await db.franchiseProject.findUnique({ where: { id: projectId } });
      check("throwaway project deleted", projectStillExists === null);
      const tasksAfterDelete = await db.task.count({ where: { projectId } });
      check("Task rows cascade-deleted with the project", tasksAfterDelete === 0);
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

  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });
    // Deliberately NOT a franchisee with isPreExistingFranchisee=true — that
    // flag auto-checks the new-project form's "skip seeding" box, which would
    // make this a pre-existing project from the start and defeat checks 1-2.
    const franchisee = await db.user.findFirstOrThrow({
      where: { role: "FRANCHISEE", isPreExistingFranchisee: false },
      select: { name: true },
    });

    await runVerification(page, browser, admin, franchisee.name);
  } finally {
    await browser.close();
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
