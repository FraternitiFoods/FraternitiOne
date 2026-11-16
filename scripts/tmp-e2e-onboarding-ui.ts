/**
 * Visual/regression pass for the Option-B onboarding reskin (Welcome, Progress,
 * KYC & Documents, LOI inside the new shell). Run with `npx tsx
 * scripts/tmp-e2e-onboarding-ui.ts` against a running `pnpm dev`. Creates ONE
 * throwaway franchisee + onboarding (tmp-e2e-ui-% emails), walks a few statuses,
 * takes 1440px / 390px screenshots into SHOT_DIR, checks no horizontal scroll,
 * keyboard focus visibility and that a real KYC upload still works, then deletes
 * everything it made (DB rows + B2 objects) in `finally`.
 */
import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { PrismaClient, type OnboardingStatus, type ReviewStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TestPassword123!";
const FR_EMAIL = "tmp-e2e-ui-franchisee@example.com";
const SALES_EMAIL = "tmp-e2e-ui-sales@example.com";
const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve("tmp-ui-shots");

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "OK  " : "FAIL", "-", label);
  if (!cond) failures++;
}

async function deleteB2Prefix(prefix: string) {
  if (!process.env.B2_ENDPOINT || !process.env.B2_BUCKET_NAME) return;
  const endpoint = process.env.B2_ENDPOINT.startsWith("http") ? process.env.B2_ENDPOINT : `https://${process.env.B2_ENDPOINT}`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: process.env.B2_KEY_ID!, secretAccessKey: process.env.B2_APPLICATION_KEY! },
  });
  const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME, Prefix: prefix }));
  for (const obj of list.Contents ?? []) {
    if (obj.Key) await client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: obj.Key }));
  }
}

async function settle(page: Page) {
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle");
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(FR_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  // networkidle alone can return before the sign-in Server Action finishes: wait for the redirect off /login.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, route: string, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${route}`);
  await settle(page);
  // The assistant card is closed on arrival everywhere; this only guards against it being open (e.g. a stale state).
  const close = page.getByRole("button", { name: "Close assistant" });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(300);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${name} @${width}: no horizontal scroll (overflow ${overflow}px)`, overflow <= 0);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}.png`), fullPage: true });
}

/** Password show/hide toggle on the login page and both reset-password fields (no submit, so nothing changes). */
async function passwordEyeChecks(page: Page, userId: string) {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  const pw = page.getByLabel("Password", { exact: true });
  check("Login: password starts hidden", (await pw.getAttribute("type")) === "password");
  await pw.fill("Secret-123");
  await page.getByRole("button", { name: "Show password" }).click();
  check("Login: Show password reveals the text and keeps the value", (await pw.getAttribute("type")) === "text" && (await pw.inputValue()) === "Secret-123");
  check("Login: toggle label flips to Hide password", (await page.getByRole("button", { name: "Hide password" }).count()) === 1);
  await page.screenshot({ path: path.join(SHOT_DIR, "login-eye-shown-1440.png") });
  await page.getByRole("button", { name: "Hide password" }).click();
  check("Login: Hide password hides again", (await pw.getAttribute("type")) === "password");
  await pw.focus();
  await page.keyboard.press("Tab");
  check("Login: eye button is keyboard-reachable (Tab from the field)", await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") === "Show password"));

  // Reset-password page: real token row (same hashing as src/lib/password-reset-tokens.ts), deleted in finally.
  const token = randomBytes(32).toString("hex");
  await db.passwordResetToken.create({
    data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId, purpose: "RESET", expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  await page.goto(`${BASE}/reset-password/${token}`);
  const np = page.getByLabel("New password", { exact: true });
  const cp = page.getByLabel("Confirm password", { exact: true });
  await np.fill("Another-123");
  await cp.fill("Another-123");
  check("Reset: two independent toggles", (await page.getByRole("button", { name: "Show password" }).count()) === 2);
  await page.getByRole("button", { name: "Show password" }).first().click();
  check("Reset: first toggle reveals only the New password field", (await np.getAttribute("type")) === "text" && (await cp.getAttribute("type")) === "password");
  await page.getByRole("button", { name: "Show password" }).click(); // the remaining one = Confirm
  check("Reset: second toggle reveals the Confirm field", (await cp.getAttribute("type")) === "text");
  await page.screenshot({ path: path.join(SHOT_DIR, "reset-eye-shown-1440.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOT_DIR, "reset-eye-shown-390.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function setStatus(
  onboardingId: string,
  status: OnboardingStatus,
  kycStatus: ReviewStatus = "MISSING",
  paymentStatus: ReviewStatus = "MISSING"
) {
  await db.storeOnboarding.update({ where: { id: onboardingId }, data: { onboardingStatus: status, kycStatus, paymentStatus } });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const sales = await db.user.create({ data: { name: "TMP UI Sales", email: SALES_EMAIL, role: "SALES", passwordHash } });
  const fr = await db.user.create({ data: { name: "Pavitra PUNE", email: FR_EMAIL, role: "FRANCHISEE", passwordHash } });
  const ob = await db.storeOnboarding.create({
    data: {
      format: "QSR",
      proposedLocation: "Pune",
      legalApplicantName: "TMP UI Applicant",
      entityType: "INDIVIDUAL",
      contactPhone: "9000000001",
      workspaceEmail: "tmp-e2e-ui-onboarding@example.com",
      franchiseeUserId: fr.id,
      salesOwnerId: sales.id,
      expectedAmount: 450000,
    },
  });
  await db.kycSubmission.create({ data: { onboardingId: ob.id } });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await passwordEyeChecks(page, fr.id);
    await login(page);

    // ---- AWAITING_KYC_PAYMENT: the state the mockups show ----
    for (const w of [1440, 390]) {
      const h = w === 1440 ? 900 : 844;
      await shot(page, "/onboarding/welcome", "welcome", w, h);
      await shot(page, "/onboarding", "progress", w, h);
      await shot(page, "/onboarding/documents", "kyc", w, h);
      await shot(page, "/onboarding/loi", "loi", w, h);
    }

    // Journey / stepper / CTA derive from status (not hardcoded).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/onboarding/welcome`);
    await settle(page);
    check("Welcome: 3-step journey list", (await page.locator("main ol > li").count()) === 3);
    check(
      "Welcome: CTA -> /onboarding/documents",
      (await page.locator("a", { hasText: "Upload KYC documents" }).first().getAttribute("href")) === "/onboarding/documents"
    );
    check("Welcome: heading greets by name", (await page.getByRole("heading", { level: 1 }).innerText()).includes("Pavitra PUNE"));
    check("Welcome: 2 play buttons, no iframe yet", (await page.getByRole("button", { name: /^Play video/ }).count()) === 2 && (await page.locator("iframe").count()) === 0);
    await page.getByRole("button", { name: /^Play video/ }).first().click();
    const src = await page.locator("iframe").first().getAttribute("src");
    check("Welcome: play still loads the youtube-nocookie embed", !!src && src.startsWith("https://www.youtube-nocookie.com/embed/"));

    // Assistant: closed on arrival on Welcome at 1440px, opened only by the button, floats (no layout shift).
    await page.goto(`${BASE}/onboarding/welcome`);
    await settle(page);
    const aside = page.getByRole("complementary", { name: "Assistant" });
    const openBtn = page.getByRole("button", { name: "Open assistant" });
    check("Welcome @1440: assistant closed on arrival, Ask assistant button visible", !(await aside.isVisible()) && (await openBtn.isVisible()));
    const before = await page.locator("main > div").boundingBox();
    await page.screenshot({ path: path.join(SHOT_DIR, "welcome-closed-1440.png") });
    await openBtn.click();
    await aside.getByText("Fraterniti Assistant").waitFor({ timeout: 20000 });
    const after = await page.locator("main > div").boundingBox();
    check("Welcome @1440: tapping the button opens it, page layout does not shift", (await aside.isVisible()) && !!before && !!after && Math.round(before.width) === Math.round(after.width));
    await page.screenshot({ path: path.join(SHOT_DIR, "welcome-opened-1440.png") });
    await aside.getByRole("button", { name: "Close assistant" }).click();
    check("Welcome @1440: close works", !(await aside.isVisible()));

    // Real KYC upload still works (tiny PNG through presign -> PUT -> finalize).
    await page.goto(`${BASE}/onboarding/documents`);
    await settle(page);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "pan.png", mimeType: "image/png", buffer: png });
    await page.getByText("pan.png (v1)").waitFor({ timeout: 30000 }).catch(() => {});
    check("KYC: uploaded file row shows file name + version", (await page.getByText("pan.png (v1)").count()) > 0);
    check("KYC: button now reads Replace", (await page.getByRole("button", { name: /Replace PAN card/ }).count()) > 0);
    await shot(page, "/onboarding/documents", "kyc-uploaded", 1440, 900);

    // Keyboard focus is visible on a control.
    await page.keyboard.press("Tab");
    let focusOk = false;
    for (let i = 0; i < 25 && !focusOk; i++) {
      await page.keyboard.press("Tab");
      focusOk = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return false;
        const cs = getComputedStyle(el);
        return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
      });
    }
    check("Keyboard focus shows a >=2px outline on onboarding controls", focusOk);

    // ---- Other statuses ----
    await setStatus(ob.id, "CORRECTIONS_REQUESTED", "CHANGES_REQUESTED", "MISSING");
    await db.kycSubmission.update({ where: { onboardingId: ob.id }, data: { decisionReason: "PAN image is blurry." } });
    await shot(page, "/onboarding/documents", "kyc-corrections", 1440, 900);
    await shot(page, "/onboarding", "progress-corrections", 1440, 900);

    await setStatus(ob.id, "UNDER_REVIEW", "SUBMITTED", "SUBMITTED");
    await shot(page, "/onboarding", "progress-review", 1440, 900);
    await page.goto(`${BASE}/onboarding`);
    await settle(page);
    check("Progress @UNDER_REVIEW: no redundant 'See your progress' button", (await page.locator("a", { hasText: "See your progress" }).count()) === 0);
    await shot(page, "/onboarding/welcome", "welcome-review", 1440, 900);

    await setStatus(ob.id, "READY_FOR_SIGNATURE", "ACCEPTED", "ACCEPTED");
    await shot(page, "/onboarding", "progress-ready", 1440, 900);
    await shot(page, "/onboarding/welcome", "welcome-ready", 1440, 900);
    await shot(page, "/onboarding/welcome", "welcome-ready", 390, 844);
    await shot(page, "/onboarding/documents", "kyc-accepted", 1440, 900);
    await shot(page, "/onboarding/loi", "loi-ready", 1440, 900);
  } finally {
    await browser.close();
    await db.paymentSubmission.deleteMany({ where: { onboardingId: ob.id } }).catch(() => {});
    await db.onboardingFile.deleteMany({ where: { onboardingId: ob.id } }).catch(() => {});
    await db.passwordResetToken.deleteMany({ where: { userId: fr.id } }).catch(() => {});
    await db.kycSubmission.deleteMany({ where: { onboardingId: ob.id } }).catch(() => {});
    await db.notificationLog.deleteMany({ where: { onboardingId: ob.id } }).catch(() => {});
    await db.auditEvent.deleteMany({ where: { onboardingId: ob.id } }).catch(() => {});
    await db.storeOnboarding.delete({ where: { id: ob.id } }).catch(() => {});
    await deleteB2Prefix(`onboarding/${ob.id}/`).catch((e) => console.error("B2 cleanup failed", e));
    for (const uid of [fr.id, sales.id]) {
      await db.auditEvent.deleteMany({ where: { OR: [{ entityId: uid }, { actorId: uid }] } }).catch(() => {});
      await db.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
