import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * plan.md section 19, build order step 8 — end-to-end verification of LOI
 * signing by mobile OTP (mock SMS), desktop + phone, plus every negative
 * test in that section's Definition of Done. Modeled directly on
 * scripts/tmp-e2e-onboarding.ts (section 17's own e2e script) — same
 * helpers, same cleanup discipline, same "wait for real state, not a
 * timeout" rule — extended with the OTP-specific flow.
 */

async function deleteB2Prefix(prefix: string) {
  const endpoint = process.env.B2_ENDPOINT!.startsWith("http") ? process.env.B2_ENDPOINT! : `https://${process.env.B2_ENDPOINT}`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: process.env.B2_KEY_ID!, secretAccessKey: process.env.B2_APPLICATION_KEY! },
  });
  const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME!, Prefix: prefix }));
  for (const obj of list.Contents ?? []) {
    if (!obj.Key) continue;
    await client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME!, Key: obj.Key }));
  }
}

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const TEST_PASSWORD = "TestPassword123!";

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
  // networkidle alone can resolve while the Server Action's client-driven
  // redirect (POST response received, but the router hasn't yet navigated
  // off /login) is still in flight — a goto() fired in that gap races the
  // session cookie and gets bounced back to /login. Wait for the URL to
  // actually leave /login before considering login "done." waitUntil
  // defaults to "load", which a Next.js App Router soft (client-side)
  // navigation never fires — "commit" is the right signal for an SPA
  // transition.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000, waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
}

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

/** Bypasses the client-side `disabled` gate and clicks for real, to prove the SERVER (not the UI) is what actually rejects a disallowed action. */
async function forceClick(page: Page, name: RegExp) {
  const btn = page.getByRole("button", { name });
  await btn.evaluate((el: HTMLButtonElement) => {
    el.disabled = false;
  });
  await btn.click();
}

/**
 * Clicks "Resend" regardless of its client-side cooldown-countdown state
 * (the test doesn't wait out the real 60s cooldown between resends). A
 * separate evaluate() + click() has a real race: React's 1s countdown timer
 * can re-render and restore `disabled` in the gap between the two round
 * trips. Setting disabled=false and calling the native DOM .click() inside
 * ONE evaluate() closes that gap — React's delegated listener still fires
 * from a synthetic .click() the same as a real one.
 */
async function forceResendClick(page: Page) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /resend/i.test(b.textContent || "")) as
      | HTMLButtonElement
      | undefined;
    if (!btn) throw new Error("Resend button not found in the DOM.");
    btn.disabled = false;
    btn.click();
  });
}

/**
 * Reads the plain OTP code off the dev-only mock SMS inbox — the one place
 * it's ever displayed outside the signer's own head. Takes a DEDICATED page
 * (never the signer's own flow page) on purpose: /dev/mock-sms is a full
 * page navigation, and navigating the signer's own tab away from
 * /onboarding/loi or /signing/[id] would unmount the OTP panel and lose its
 * in-progress client state (resend/wrong-attempt/replay all depend on that
 * state surviving between steps).
 */
async function getLatestOtpCode(inbox: Page, toE164: string): Promise<string> {
  await inbox.goto(`${BASE}/dev/mock-sms`);
  const item = inbox.locator("li", { hasText: toE164 }).first();
  await item.waitFor({ timeout: 5000 });
  const code = await item.locator(".font-mono").innerText();
  return code.trim();
}

async function uploadKycAndPayment(page: Page, onboardingId: string, utr: string) {
  await page.goto(`${BASE}/onboarding/documents`);
  await page.setInputFiles('input[type="file"]', { name: "pan.png", mimeType: "image/png", buffer: onePixelPng() });
  await page.getByText("Clean").first().waitFor({ timeout: 15000 });
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(1).setInputFiles({ name: "aadhaar.png", mimeType: "image/png", buffer: onePixelPng() });
  await page.getByText("Clean").nth(1).waitFor({ timeout: 15000 });

  await page.getByLabel("PAN number").fill("ABCDE1234F");
  await page.getByLabel("Name on PAN").fill("E2E19 Franchisee");
  await page.getByLabel("Name on Aadhaar").fill("E2E19 Franchisee");
  await page.getByLabel(/last 4 digits/i).fill("1234");
  await page.getByRole("button", { name: /save details/i }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /submit for review/i }).click();
  await page.waitForTimeout(800);

  await page.getByLabel(/amount paid/i).fill("1000");
  await page.getByLabel(/payment date/i).fill("2026-10-01");
  await page.getByLabel(/payment mode/i).fill("NEFT");
  await page.getByLabel(/UTR/i).fill(utr);
  await page.locator("input#receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: onePixelPng() });
  await page.getByRole("button", { name: /submit payment receipt/i }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Submitting…"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  const kyc = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId } });
  const payment = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId }, orderBy: { createdAt: "desc" } });
  check(`[${onboardingId}] KYC submitted`, kyc.status === "SUBMITTED");
  check(`[${onboardingId}] Payment submitted`, payment.status === "SUBMITTED");
}

async function acceptKycAndPayment(browser: Browser, onboardingId: string, storeNameText: RegExp) {
  const kyc = await browser.newPage();
  await login(kyc, "e2e19-kyc@example.com", TEST_PASSWORD);
  await kyc.goto(`${BASE}/reviews?tab=kyc`);
  await kyc.getByText(storeNameText).click();
  await kyc.waitForLoadState("networkidle");
  await kyc.getByRole("button", { name: /accept kyc/i }).click();
  await kyc.waitForTimeout(1500);
  await kyc.close();
  const kycRow = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId } });
  check(`[${onboardingId}] KYC accepted`, kycRow.status === "ACCEPTED");

  const acc = await browser.newPage();
  await login(acc, "e2e19-accounts@example.com", TEST_PASSWORD);
  await acc.goto(`${BASE}/reviews?tab=payment`);
  await acc.getByText(storeNameText).click();
  await acc.waitForLoadState("networkidle");
  await acc.getByLabel(/verified amount/i).fill("1000");
  await acc.getByRole("button", { name: /accept payment/i }).click();
  await acc.waitForTimeout(1500);
  await acc.close();
  const paymentRow = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId }, orderBy: { createdAt: "desc" } });
  check(`[${onboardingId}] Payment accepted`, paymentRow.status === "ACCEPTED" && paymentRow.verifiedAmount === 100000);
}

async function generateAndReleaseLoi(browser: Browser, onboardingId: string, territory: string) {
  const prep = await browser.newPage();
  await login(prep, "e2e19-loi@example.com", TEST_PASSWORD);
  await prep.goto(`${BASE}/store-onboarding/${onboardingId}`);
  await prep.getByLabel("Territory").fill(territory);
  await prep.getByRole("button", { name: /generate loi|generate new version/i }).click();
  await prep.waitForTimeout(2500);
  await prep.waitForLoadState("networkidle");
  await prep.getByRole("button", { name: /release for signing/i }).click();
  await prep.waitForTimeout(2000);
  await prep.waitForLoadState("networkidle");
  await prep.close();

  const loi = await db.loiVersion.findFirstOrThrow({ where: { onboardingId, status: "RELEASED" }, orderBy: { createdAt: "desc" } });
  check(`[${onboardingId}] LOI v${loi.versionNo} released`, loi.status === "RELEASED");
  const onboardingReady = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  check(`[${onboardingId}] READY_FOR_SIGNATURE`, onboardingReady.onboardingStatus === "READY_FOR_SIGNATURE");
  return loi;
}

async function createOnboardingViaUI(
  admin: Page,
  opts: { proposedLocation: string; contactPhone: string; workspaceEmail: string; franchiseeName: string }
) {
  await admin.goto(`${BASE}/store-onboarding/new`);
  await admin.getByLabel("Format").fill("QSR");
  await admin.getByLabel("Proposed location").fill(opts.proposedLocation);
  await admin.getByLabel("Legal applicant name").fill(opts.franchiseeName);
  await admin.getByLabel("Franchisee name").fill(opts.franchiseeName);
  await admin.getByLabel("Contact phone").fill(opts.contactPhone);
  await admin.getByLabel("Workspace email").fill(opts.workspaceEmail);
  await admin.getByLabel(/sales owner/i).click();
  await admin.getByRole("option", { name: /Sales Demo/i }).click();
  await admin.getByText(/Sales Demo/i).first().waitFor({ timeout: 5000 });
  await admin.getByLabel(/LOI fee amount/i).fill("1000");
  await admin.getByRole("button", { name: /create onboarding/i }).click();
  await admin.waitForURL(/\/store-onboarding\/[a-z0-9]*\d[a-z0-9]*$/, { timeout: 15000 });

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { workspaceEmail: opts.workspaceEmail } });
  await db.user.update({ where: { id: onboarding.franchiseeUserId }, data: { passwordHash: await bcrypt.hash(TEST_PASSWORD, 12) } });
  return onboarding;
}

async function main() {
  const browser: Browser = await chromium.launch();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  check("Pre-check: SIGNING_METHOD is SMS_OTP (section 19 default)", (process.env.SIGNING_METHOD ?? "SMS_OTP") === "SMS_OTP");
  check("Pre-check: SMS_PROVIDER is mock (safe to run)", (process.env.SMS_PROVIDER ?? "mock") === "mock");

  // ---- Baseline: every FranchiseProject's task count, before this run touches anything ----
  const baselineProjects = await db.franchiseProject.findMany({
    select: { id: true, location: true, _count: { select: { tasks: true } } },
  });
  const bengaluru = baselineProjects.find((p) => /bengaluru/i.test(p.location));
  const ashokVihar = baselineProjects.find((p) => /ashok vihar/i.test(p.location));
  if (!bengaluru || !ashokVihar) {
    console.log(
      "NOTE: no project named 'Bengaluru' or 'Ashok Vihar' exists in this dev database " +
        `(found ${baselineProjects.length} project(s): ${baselineProjects.map((p) => p.location).join(", ") || "none"}). ` +
        "Falling back to confirming every pre-existing real project's task count is unchanged by this run instead."
    );
  }

  await db.user.findUniqueOrThrow({ where: { email: "sales.demo@fraterniti.co.in" } }); // pre-flight: createOnboardingViaUI picks this via the UI dropdown
  const [kycReviewer, accounts, loiPreparer, signatory, franchiseeC, e2eAdmin] = await Promise.all([
    db.user.create({ data: { name: "E2E19 KYC Reviewer", email: "e2e19-kyc@example.com", role: "KYC_REVIEWER", passwordHash } }),
    db.user.create({ data: { name: "E2E19 Accounts", email: "e2e19-accounts@example.com", role: "ACCOUNTS", passwordHash } }),
    db.user.create({ data: { name: "E2E19 LOI Preparer", email: "e2e19-loi@example.com", role: "LOI_PREPARER", passwordHash } }),
    db.user.create({
      data: { name: "E2E19 Signatory", email: "e2e19-signatory@example.com", role: "COMPANY_SIGNATORY", passwordHash, phone: "9876500099" },
    }),
    db.user.create({ data: { name: "E2E19 Franchisee C", email: "e2e19-franchiseeC@example.com", role: "FRANCHISEE", passwordHash } }),
    // Throwaway ADMIN for creating onboardings via the UI — NOT the real
    // tech@fraterniti.co.in account. That account's actual DB password
    // doesn't match .env's SEED_DEV_PASSWORD in this environment (pre-
    // existing drift, unrelated to section 19), and overwriting a real
    // admin's credential — even temporarily — isn't a risk worth taking
    // just to drive a test script.
    db.user.create({ data: { name: "E2E19 Admin", email: "e2e19-admin@example.com", role: "ADMIN", passwordHash } }),
  ]);
  const ADMIN_EMAIL = e2eAdmin.email!;

  // Dedicated, never-navigated-elsewhere page for reading the mock SMS inbox
  // — see getLatestOtpCode's own comment for why this must be separate from
  // every signer's own flow page.
  const inbox = await browser.newPage();

  const cleanupUserIds = [kycReviewer.id, accounts.id, loiPreparer.id, signatory.id, franchiseeC.id, e2eAdmin.id];
  const cleanupOnboardingIds: string[] = [];
  const cleanupProjectIds: string[] = [];

  try {
    // =========================================================================
    // PHASE 1 — happy path: gates pass, both signers OTP-sign, project created.
    // =========================================================================
    const admin1 = await browser.newPage();
    await login(admin1, ADMIN_EMAIL, TEST_PASSWORD);
    const happy = await createOnboardingViaUI(admin1, {
      proposedLocation: "E2E19 Happy City",
      contactPhone: "9876500001",
      workspaceEmail: "e2e19-happy@tulsi.world",
      franchiseeName: "E2E19 Happy Franchisee",
    });
    await admin1.close();
    cleanupOnboardingIds.push(happy.id);
    cleanupUserIds.push(happy.franchiseeUserId);

    const fr1 = await browser.newPage();
    await login(fr1, "e2e19-happy@tulsi.world", TEST_PASSWORD);
    await uploadKycAndPayment(fr1, happy.id, "E2E19UTR001");
    await fr1.close();

    await acceptKycAndPayment(browser, happy.id, /E2E19 Happy City/i);
    const happyLoi = await generateAndReleaseLoi(browser, happy.id, "Bengaluru Urban");

    // ---- Franchisee signs by OTP ----
    const fr2 = await browser.newPage();
    await login(fr2, "e2e19-happy@tulsi.world", TEST_PASSWORD);
    await fr2.goto(`${BASE}/onboarding/loi`);
    check("Button reads 'Sign LOI with OTP' (SIGNING_METHOD=SMS_OTP)", await fr2.getByRole("button", { name: /sign loi with otp/i }).isVisible());

    // Negative: request OTP before opening the preview (server-side gate, not just UI).
    await fr2.getByLabel(/i have read the loi/i).check();
    await fr2.getByRole("button", { name: /sign loi with otp/i }).click();
    await fr2.waitForTimeout(600);
    check(
      "Cannot request OTP without opening the preview first",
      await fr2.getByText(/open the loi preview/i).isVisible()
    );
    check("No OtpChallenge row created by the blocked request", (await db.otpChallenge.count({ where: { loiVersionId: happyLoi.id, signerRole: "FRANCHISEE" } })) === 0);

    // Open the preview for real (same route a click on "Preview LOI (PDF)" hits).
    const previewResp = await fr2.request.get(`${BASE}/api/loi-versions/${happyLoi.id}/download`);
    check("Preview LOI download route reachable", previewResp.status() < 400);

    await fr2.getByRole("button", { name: /sign loi with otp/i }).click();
    await fr2.waitForTimeout(800);
    check("Franchisee: OTP send succeeded, code-entry step shown", await fr2.getByLabel(/enter the 6-digit code/i).isVisible());

    // Open a phone-sized tab mid-flow — covers the mobile UI pass AND doubles
    // as the untouched "replay" tab used at the end of this phase.
    const frMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(frMobile, "e2e19-happy@tulsi.world", TEST_PASSWORD);
    await frMobile.goto(`${BASE}/onboarding/loi`);
    await frMobile.getByLabel(/enter the 6-digit code/i).waitFor({ timeout: 5000 });
    const scrollW = await frMobile.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await frMobile.evaluate(() => document.documentElement.clientWidth);
    check("Mobile viewport (390px), /onboarding/loi code-entry step: no horizontal overflow", scrollW <= clientW + 1);

    const codeA = await getLatestOtpCode(inbox, "+919876500001");
    check("Got OTP code A from /dev/mock-sms", /^\d{6}$/.test(codeA));

    // Wrong code counts. (.first() — both the error line and the static
    // "N attempt(s) left" counter can contain the same substring at once.)
    await fr2.getByLabel(/enter the 6-digit code/i).fill("000000");
    await fr2.getByRole("button", { name: "Verify" }).click();
    await fr2.waitForTimeout(500);
    check("Wrong code #1: attempts-left shown", await fr2.getByText(/4 attempt\(s\) left/i).first().isVisible());
    await fr2.getByLabel(/enter the 6-digit code/i).fill("111111");
    await fr2.getByRole("button", { name: "Verify" }).click();
    await fr2.waitForTimeout(500);
    check("Wrong code #2: attempts-left decreased further", await fr2.getByText(/3 attempt\(s\) left/i).first().isVisible());

    // Resend supersedes the old code.
    await forceResendClick(fr2);
    await fr2.waitForTimeout(800);
    const codeB = await getLatestOtpCode(inbox, "+919876500001");
    check("Resend issued a different code (B != A)", codeB !== codeA && /^\d{6}$/.test(codeB));

    await fr2.getByLabel(/enter the 6-digit code/i).fill(codeA);
    await fr2.getByRole("button", { name: "Verify" }).click();
    await fr2.waitForTimeout(500);
    check("Old code A rejected after resend (superseded)", await fr2.getByText(/already been used or replaced/i).isVisible());

    await fr2.getByLabel(/enter the 6-digit code/i).fill(codeB);
    await fr2.getByRole("button", { name: "Verify" }).click();
    await fr2.waitForTimeout(1500);
    const franchiseeAttempt = await db.esignAttempt.findFirstOrThrow({ where: { loiVersionId: happyLoi.id, signerRole: "FRANCHISEE" } });
    const loiAfterFr = await db.loiVersion.findUniqueOrThrow({ where: { id: happyLoi.id } });
    const franchiseeAcceptance = await db.loiAcceptance.findUniqueOrThrow({
      where: { loiVersionId_signerRole: { loiVersionId: happyLoi.id, signerRole: "FRANCHISEE" } },
    });
    check("Franchisee OTP verified, EsignAttempt COMPLETED (provider sms_otp)", franchiseeAttempt.status === "COMPLETED" && franchiseeAttempt.provider === "sms_otp");
    check("LOI status FRANCHISE_SIGNED", loiAfterFr.status === "FRANCHISE_SIGNED");
    check("LoiAcceptance recorded for FRANCHISEE with preview-opened + consent snapshot", franchiseeAcceptance.previewOpenedAt !== null && franchiseeAcceptance.consentText.length > 0);
    await fr2.close();

    // Replay: the idle mobile tab still has code B typed in from a moment it hadn't yet refreshed.
    await frMobile.getByLabel(/enter the 6-digit code/i).fill(codeB);
    await frMobile.getByRole("button", { name: "Verify" }).click();
    await frMobile.waitForTimeout(600);
    check("Replaying the already-verified challenge does nothing (rejected, not double-processed)", await frMobile.getByText(/already been used or replaced/i).isVisible());
    check("Exactly one LoiAcceptance row for FRANCHISEE despite the replay attempt", (await db.loiAcceptance.count({ where: { loiVersionId: happyLoi.id, signerRole: "FRANCHISEE" } })) === 1);
    await frMobile.close();

    // ---- Company signatory signs by OTP ----
    const sig1 = await browser.newPage();
    await login(sig1, "e2e19-signatory@example.com", TEST_PASSWORD);
    await sig1.goto(`${BASE}/signing/${happy.id}`);
    check("Button reads 'Countersign LOI with OTP'", await sig1.getByRole("button", { name: /countersign loi with otp/i }).isVisible());

    await sig1.getByLabel(/i have read the loi/i).check();
    await sig1.getByRole("button", { name: /countersign loi with otp/i }).click();
    await sig1.waitForTimeout(600);
    check("Company cannot request OTP without opening the preview", await sig1.getByText(/open the loi preview/i).isVisible());

    await sig1.request.get(`${BASE}/api/loi-versions/${happyLoi.id}/download`);
    await sig1.getByRole("button", { name: /countersign loi with otp/i }).click();
    await sig1.waitForTimeout(800);

    const sigMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(sigMobile, "e2e19-signatory@example.com", TEST_PASSWORD);
    await sigMobile.goto(`${BASE}/signing/${happy.id}`);
    const sigScrollW = await sigMobile.evaluate(() => document.documentElement.scrollWidth);
    const sigClientW = await sigMobile.evaluate(() => document.documentElement.clientWidth);
    if (sigScrollW > sigClientW + 1) {
      const widest = await sigMobile.evaluate(() => {
        let el: Element | null = null;
        let maxW = 0;
        document.querySelectorAll("*").forEach((e) => {
          if (e.scrollWidth > maxW) {
            maxW = e.scrollWidth;
            el = e;
          }
        });
        return el ? { tag: (el as Element).tagName, cls: (el as HTMLElement).className, w: maxW } : null;
      });
      console.log(`[debug] /signing/[id] mobile overflow: scrollW=${sigScrollW} clientW=${sigClientW} widest=`, widest);
    }
    check("Mobile viewport (390px), /signing/[id]: no horizontal overflow", sigScrollW <= sigClientW + 1);
    await sigMobile.close();

    const companyCode = await getLatestOtpCode(inbox, "+919876500099");
    await sig1.getByLabel(/enter the 6-digit code/i).fill(companyCode);
    await sig1.getByRole("button", { name: "Verify" }).click();
    await sig1.waitForTimeout(5000); // company completion also builds + uploads the acceptance certificate
    await sig1.close();

    const happyFinal = await db.storeOnboarding.findUniqueOrThrow({ where: { id: happy.id } });
    const loiFinal = await db.loiVersion.findUniqueOrThrow({ where: { id: happyLoi.id } });
    check("Company OTP verified -> LOI SIGNED", loiFinal.status === "SIGNED");
    check("Onboarding -> LOI_COMPLETE", happyFinal.onboardingStatus === "LOI_COMPLETE");
    check("Onboarding.projectId === reservedProjectId", happyFinal.projectId === happy.reservedProjectId);
    check("Signed LOI hash unchanged from the original (section 19 decision 4)", loiFinal.signedPdfSha256 === loiFinal.pdfSha256);
    if (happyFinal.projectId) cleanupProjectIds.push(happyFinal.projectId);

    if (happyFinal.projectId) {
      const project = await db.franchiseProject.findUnique({ where: { id: happyFinal.projectId }, include: { _count: { select: { tasks: true } } } });
      check("FranchiseProject created with seeded tasks (~963)", (project?._count.tasks ?? 0) > 900);
      const legalDocs = await db.document.count({ where: { projectId: happyFinal.projectId, category: "LEGAL" } });
      check("Signed LOI + Acceptance Certificate filed as Legal documents", legalDocs === 2);

      const dl = await browser.newPage();
      await login(dl, "e2e19-happy@tulsi.world", TEST_PASSWORD);
      const respSigned = await dl.request.get(`${BASE}/api/loi-versions/${happyLoi.id}/download?file=signed`);
      check("Signed LOI download reachable", respSigned.status() < 400);
      const respCert = await dl.request.get(`${BASE}/api/loi-versions/${happyLoi.id}/download?file=certificate`);
      check("Acceptance Certificate download reachable", respCert.status() < 400);
      await dl.close();
    }

    // ---- No plain OTP anywhere ----
    const auditRows = await db.auditEvent.findMany({ where: { onboardingId: happy.id } });
    const notificationRows = await db.notificationLog.findMany({ where: { onboardingId: happy.id } });
    const esignEventRows = await db.esignEvent.findMany({ where: { attempt: { loiVersion: { onboardingId: happy.id } } } });
    const codesUsed = [codeA, codeB, companyCode];
    const auditLeak = auditRows.some((r) => codesUsed.some((c) => JSON.stringify(r.oldValue ?? {}).includes(c) || JSON.stringify(r.newValue ?? {}).includes(c)));
    const notifLeak = notificationRows.some((r) => codesUsed.some((c) => (r.error ?? "").includes(c)));
    const eventLeak = esignEventRows.some((r) => codesUsed.some((c) => JSON.stringify(r.payload).includes(c)));
    check("No plain OTP value in any AuditEvent row", !auditLeak);
    check("No plain OTP value in any NotificationLog row", !notifLeak);
    check("No plain OTP value in any EsignEvent row", !eventLeak);

    // ---- Isolation: a second franchisee cannot touch this store by URL ----
    const frC = await browser.newPage();
    await login(frC, "e2e19-franchiseeC@example.com", TEST_PASSWORD);
    await frC.goto(`${BASE}/store-onboarding/${happy.id}`);
    const bodyC = await frC.locator("body").innerText();
    check("P1-03: a second franchisee cannot open the first store's internal URL", !bodyC.includes("E2E19 Happy City"));
    await frC.close();

    // =========================================================================
    // PHASE 2 — negative-test onboarding: lock, expiry, version mismatch,
    // company-before-franchisee, failed SMS send.
    // =========================================================================
    const admin2 = await browser.newPage();
    await login(admin2, ADMIN_EMAIL, TEST_PASSWORD);
    const neg = await createOnboardingViaUI(admin2, {
      proposedLocation: "E2E19 Negative City",
      contactPhone: "9876500002",
      workspaceEmail: "e2e19-negative@tulsi.world",
      franchiseeName: "E2E19 Negative Franchisee",
    });
    await admin2.close();
    cleanupOnboardingIds.push(neg.id);
    cleanupUserIds.push(neg.franchiseeUserId);

    const fr3 = await browser.newPage();
    await login(fr3, "e2e19-negative@tulsi.world", TEST_PASSWORD);
    await uploadKycAndPayment(fr3, neg.id, "E2E19UTR002");
    await fr3.close();
    await acceptKycAndPayment(browser, neg.id, /E2E19 Negative City/i);
    let negLoi = await generateAndReleaseLoi(browser, neg.id, "Ashok Vihar, Delhi");

    // ---- Company cannot accept before the franchisee ----
    const sig2 = await browser.newPage();
    await login(sig2, "e2e19-signatory@example.com", TEST_PASSWORD);
    await sig2.goto(`${BASE}/signing/${neg.id}`);
    await sig2.request.get(`${BASE}/api/loi-versions/${negLoi.id}/download`);
    await sig2.reload();
    await sig2.getByLabel(/i have read the loi/i).check();
    await forceClick(sig2, /countersign loi with otp/i);
    await sig2.waitForTimeout(600);
    check("Company cannot request OTP before the franchisee signs (server-rejected despite forced click)", await sig2.getByText(/company sign isn.t available/i).isVisible());
    check("No OtpChallenge created for COMPANY before franchisee completes", (await db.otpChallenge.count({ where: { loiVersionId: negLoi.id, signerRole: "COMPANY" } })) === 0);
    await sig2.close();

    // ---- 5 wrong OTPs lock ----
    const fr4 = await browser.newPage();
    await login(fr4, "e2e19-negative@tulsi.world", TEST_PASSWORD);
    await fr4.request.get(`${BASE}/api/loi-versions/${negLoi.id}/download`);
    await fr4.goto(`${BASE}/onboarding/loi`);
    await fr4.getByLabel(/i have read the loi/i).check();
    await fr4.getByRole("button", { name: /sign loi with otp/i }).click();
    await fr4.waitForTimeout(800);
    for (let i = 1; i <= 5; i++) {
      await fr4.getByLabel(/enter the 6-digit code/i).fill(String(i).padStart(6, "9"));
      await fr4.getByRole("button", { name: "Verify" }).click();
      await fr4.waitForTimeout(400);
    }
    check("5th wrong OTP locks the challenge", await fr4.getByText(/too many wrong attempts/i).isVisible());
    let negChallenge = await db.otpChallenge.findFirstOrThrow({ where: { loiVersionId: negLoi.id, signerRole: "FRANCHISEE" }, orderBy: { createdAt: "desc" } });
    check("OtpChallenge.status LOCKED after 5 wrong attempts", negChallenge.status === "LOCKED" && negChallenge.attempts === 5);

    // ---- Expired OTP rejected ----
    await forceResendClick(fr4);
    await fr4.waitForTimeout(800);
    const expiringCode = await getLatestOtpCode(inbox, "+919876500002");
    negChallenge = await db.otpChallenge.findFirstOrThrow({ where: { loiVersionId: negLoi.id, signerRole: "FRANCHISEE" }, orderBy: { createdAt: "desc" } });
    await db.otpChallenge.update({ where: { id: negChallenge.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await fr4.getByLabel(/enter the 6-digit code/i).fill(expiringCode);
    await fr4.getByRole("button", { name: "Verify" }).click();
    await fr4.waitForTimeout(600);
    check("Expired OTP rejected even with the correct code", await fr4.getByText(/code has expired/i).isVisible());

    // ---- OTP for v1.0 rejected once v1.1 is released (version/hash mismatch) ----
    await forceResendClick(fr4);
    await fr4.waitForTimeout(800);
    const staleVersionCode = await getLatestOtpCode(inbox, "+919876500002");

    const oldNegLoiId = negLoi.id;
    negLoi = await generateAndReleaseLoi(browser, neg.id, "Ashok Vihar, Delhi (revised)");
    check("New LOI version released while an OTP was pending on the old one", negLoi.id !== oldNegLoiId);

    // Deliberately NOT reloading fr4 — the franchisee had the code-entry
    // screen open when the version changed underneath them; verify must
    // reject it as stale without the page ever refreshing.
    await fr4.getByLabel(/enter the 6-digit code/i).fill(staleVersionCode);
    await fr4.getByRole("button", { name: "Verify" }).click();
    await fr4.waitForTimeout(600);
    check("OTP for the superseded LOI version rejected after a new version is released", await fr4.getByText(/loi has changed since/i).isVisible());

    // Finish signing on the new version for real.
    await forceResendClick(fr4);
    await fr4.waitForTimeout(800);
    const finalCode = await getLatestOtpCode(inbox, "+919876500002");
    await fr4.getByLabel(/enter the 6-digit code/i).fill(finalCode);
    await fr4.getByRole("button", { name: "Verify" }).click();
    await fr4.waitForTimeout(1500);
    await fr4.close();
    const negFranchiseeAttempt = await db.esignAttempt.findFirstOrThrow({ where: { loiVersionId: negLoi.id, signerRole: "FRANCHISEE" } });
    check("Franchisee eventually signs the current version successfully", negFranchiseeAttempt.status === "COMPLETED");

    // ---- A failed SMS send leaves no pending challenge ----
    await db.user.update({ where: { id: signatory.id }, data: { phone: "9999999999" } }); // reserved mock-SMS failure number
    const sig3 = await browser.newPage();
    await login(sig3, "e2e19-signatory@example.com", TEST_PASSWORD);
    await sig3.goto(`${BASE}/signing/${neg.id}`);
    await sig3.request.get(`${BASE}/api/loi-versions/${negLoi.id}/download`);
    await sig3.reload();
    await sig3.getByLabel(/i have read the loi/i).check();
    await sig3.getByRole("button", { name: /countersign loi with otp/i }).click();
    await sig3.waitForTimeout(800);
    check("Failed SMS send shows a clear error", await sig3.getByText(/could not send otp/i).isVisible());
    check("No pending OtpChallenge left behind after a failed send", (await db.otpChallenge.count({ where: { loiVersionId: negLoi.id, signerRole: "COMPANY" } })) === 0);
    const companyAttemptAfterFail = await db.esignAttempt.findFirst({ where: { loiVersionId: negLoi.id, signerRole: "COMPANY" } });
    check("No company EsignAttempt left in SENT state after a failed send", companyAttemptAfterFail === null || companyAttemptAfterFail.status !== "SENT");
    await sig3.close();

    // Fix the number and complete the flow for real.
    await db.user.update({ where: { id: signatory.id }, data: { phone: "9876500099" } });
    const sig4 = await browser.newPage();
    await login(sig4, "e2e19-signatory@example.com", TEST_PASSWORD);
    await sig4.goto(`${BASE}/signing/${neg.id}`);
    await sig4.getByLabel(/i have read the loi/i).check();
    await sig4.getByRole("button", { name: /countersign loi with otp/i }).click();
    await sig4.waitForTimeout(800);
    const negCompanyCode = await getLatestOtpCode(inbox, "+919876500099");
    await sig4.getByLabel(/enter the 6-digit code/i).fill(negCompanyCode);
    await sig4.getByRole("button", { name: "Verify" }).click();
    await sig4.waitForTimeout(5000);
    await sig4.close();

    const negFinal = await db.storeOnboarding.findUniqueOrThrow({ where: { id: neg.id } });
    check("Negative-test onboarding also reaches LOI_COMPLETE after fixing the number", negFinal.onboardingStatus === "LOI_COMPLETE");
    if (negFinal.projectId) cleanupProjectIds.push(negFinal.projectId);
  } finally {
    await browser.close();

    for (const pid of cleanupProjectIds) {
      await db.document.deleteMany({ where: { projectId: pid } });
      await db.task.deleteMany({ where: { projectId: pid } });
      await db.auditEvent.updateMany({ where: { projectId: pid }, data: { projectId: null } }).catch(() => {});
      await db.franchiseProject.delete({ where: { id: pid } }).catch(() => {});
    }
    for (const oid of cleanupOnboardingIds) {
      await db.loiAcceptance.deleteMany({ where: { loiVersion: { onboardingId: oid } } }).catch(() => {});
      await db.otpChallenge.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.esignEvent.deleteMany({ where: { attempt: { loiVersion: { onboardingId: oid } } } }).catch(() => {});
      await db.esignAttempt.deleteMany({ where: { loiVersion: { onboardingId: oid } } }).catch(() => {});
      await db.loiVersion.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.paymentSubmission.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.onboardingFile.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.kycSubmission.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.notificationLog.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.auditEvent.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.storeOnboarding.delete({ where: { id: oid } }).catch(() => {});
      await deleteB2Prefix(`onboarding/${oid}/`).catch((e) => console.error("B2 cleanup failed for", oid, e));
    }
    for (const uid of cleanupUserIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }

    // ---- Baseline projects untouched ----
    const afterProjects = await db.franchiseProject.findMany({
      select: { id: true, location: true, _count: { select: { tasks: true } } },
    });
    let baselineOk = baselineProjects.length === afterProjects.length;
    for (const before of baselineProjects) {
      const after = afterProjects.find((p) => p.id === before.id);
      if (!after || after._count.tasks !== before._count.tasks) baselineOk = false;
    }
    check(
      `Pre-existing real project(s) untouched (${baselineProjects.map((p) => `${p.location}=${p._count.tasks}`).join(", ") || "none existed"})`,
      baselineOk
    );
    if (!bengaluru || !ashokVihar) {
      console.log(
        "NOTE (repeated): 'Bengaluru' and/or 'Ashok Vihar' specifically do not exist in this dev database, " +
          "so the literal check plan.md section 19 asks for could not be run as named — see the final report."
      );
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
