import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * CI smoke suite — run in `.github/workflows/ci.yml`'s `e2e` job against a
 * throwaway Postgres service container + `pnpm dev`, never against the real
 * dev DB. Rewritten for the `new` branch baseline (plan.md milestone M0):
 * everything the old suite covered (task creation, sales import, project
 * isolation, ...) belonged to modules removed on this branch. Covers what
 * actually exists now — login, landing on /site-boq, and the
 * internal-only 403 gate — and should grow alongside Site BOQ's own
 * milestones (M1+) rather than being rewritten wholesale again.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD!;
if (!DEV_PASSWORD) throw new Error("SEED_DEV_PASSWORD not set");

const FRANCHISEE_EMAIL = "ci-smoke-franchisee@example.com";
const THROWAWAY_PASSWORD = "CiSmokeTest123!";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

async function main() {
  await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({
    data: { name: "CI Smoke Franchisee", email: FRANCHISEE_EMAIL, role: "FRANCHISEE", passwordHash },
  });

  const browser: Browser = await chromium.launch();

  try {
    // ---- Unauthenticated request is bounced to /login (proxy.ts). ----
    const anonPage = await browser.newPage();
    const anonResp = await anonPage.goto(`${BASE}/site-boq`);
    check("anonymous request to /site-boq redirects to /login", anonPage.url().includes("/login"));
    check("that redirect did not 5xx", (anonResp?.status() ?? 200) < 500);
    await anonPage.close();

    // ---- Admin logs in and lands on /site-boq (plan.md section 2). ----
    const adminPage = await browser.newPage();
    await login(adminPage, "tech@fraterniti.co.in", DEV_PASSWORD);
    check("admin login lands on /site-boq", adminPage.url().endsWith("/site-boq"));
    await adminPage.waitForSelector("text=Site BOQ", { timeout: 10000 });
    check("Site BOQ shell rendered", true);
    await adminPage.close();

    // ---- Franchisee (external role) gets 403 on /site-boq. ----
    const franchiseePage = await browser.newPage();
    await login(franchiseePage, FRANCHISEE_EMAIL, THROWAWAY_PASSWORD);
    const boqResp = await franchiseePage.goto(`${BASE}/site-boq`);
    check("franchisee hitting /site-boq gets 403", boqResp?.status() === 403);
    await franchiseePage.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await db.user.deleteMany({ where: { email: FRANCHISEE_EMAIL } }).catch((e) => {
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
