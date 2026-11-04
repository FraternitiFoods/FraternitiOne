import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Verifies the fixes from the "/site-boq/vendors crash + site-wide
 * navigation slowness" pass: the vendors page loads without the generic
 * Next.js crash screen, sidebar navigation between modules works end to
 * end, and the Site Tracker page no longer makes two sequential client
 * round trips on initial load (src/app/(app)/site-tracker/page.tsx now
 * seeds its data server-side). Needs `pnpm dev` running first. Logs in as
 * a throwaway ADMIN user created here (not the real tech@fraterniti.co.in
 * account) specifically to avoid tripping that account's 5-attempt login
 * lockout (src/app/(auth)/login/actions.ts) with a guessed password.
 */

const db = new PrismaClient();
const BASE = "http://localhost:3000";

const ADMIN_EMAIL = "tmp-e2e-nav-admin@example.com";
const THROWAWAY_PASSWORD = "TmpE2eNavTest123!";

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
  await db.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  const passwordHash = await bcrypt.hash(THROWAWAY_PASSWORD, 12);
  await db.user.create({
    data: { name: "Tmp E2E Nav Admin", email: ADMIN_EMAIL, role: "ADMIN", passwordHash },
  });

  const browser: Browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await login(page, ADMIN_EMAIL, THROWAWAY_PASSWORD);

    // ---- /site-boq/vendors must render, not crash. ----
    const vendorsResp = await page.goto(`${BASE}/site-boq/vendors`);
    check("Vendors page responds 200", vendorsResp?.status() === 200);
    const vendorsText = await page.locator("body").innerText();
    check("Vendors page did not render the generic crash screen", !vendorsText.includes("This page couldn't load"));
    check("Vendors page rendered its own content", vendorsText.includes("Site BOQ"));

    // ---- Sidebar navigation between modules, via real clicks (not direct goto). ----
    await page.goto(`${BASE}/site-boq`);
    await page.getByRole("link", { name: /vendors/i }).first().click();
    await page.waitForURL(/\/site-boq\/vendors/);
    check("Sub-nav click to Vendors landed correctly", page.url().includes("/site-boq/vendors"));

    const siteTrackerLink = page.getByRole("link", { name: /site tracker/i }).first();
    if (await siteTrackerLink.count()) {
      // ---- Site Tracker: count client requests to the tracker API during initial load. ----
      let trackerApiRequests = 0;
      page.on("request", (req) => {
        if (req.url().includes("/api/tracker/sites")) trackerApiRequests++;
      });

      await siteTrackerLink.click();
      await page.waitForURL(/\/site-tracker/);
      await page.waitForLoadState("networkidle");

      const trackerText = await page.locator("body").innerText();
      check("Site Tracker page rendered without crashing", !trackerText.includes("This page couldn't load"));
      check(
        `Site Tracker made 0 client-side /api/tracker/sites requests on initial load (got ${trackerApiRequests}) — data is now server-seeded`,
        trackerApiRequests === 0
      );
    } else {
      console.log("SKIP - Site Tracker nav link not visible for this user, skipping its checks");
    }

    await page.close();
  } catch (verificationError) {
    console.error("VERIFICATION STEP THREW:", verificationError);
    failures++;
  } finally {
    await browser.close();
    await db.user.deleteMany({ where: { email: ADMIN_EMAIL } }).catch((e) => {
      console.error("Failed to delete throwaway admin user:", e);
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
