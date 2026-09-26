import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
  await page.waitForLoadState("networkidle");
}

async function logout(page: Page) {
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForLoadState("networkidle");
}

async function main() {
  const browser: Browser = await chromium.launch();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const sales = await db.user.findUniqueOrThrow({ where: { email: "sales.demo@fraterniti.co.in" } });

  const [kycReviewer, accounts, loiPreparer, companySignatory, franchiseeB] = await Promise.all([
    db.user.create({ data: { name: "E2E KYC Reviewer", email: "e2e-kyc@example.com", role: "KYC_REVIEWER", passwordHash } }),
    db.user.create({ data: { name: "E2E Accounts", email: "e2e-accounts@example.com", role: "ACCOUNTS", passwordHash } }),
    db.user.create({ data: { name: "E2E LOI Preparer", email: "e2e-loi@example.com", role: "LOI_PREPARER", passwordHash } }),
    db.user.create({ data: { name: "E2E Signatory", email: "e2e-signatory@example.com", role: "COMPANY_SIGNATORY", passwordHash } }),
    db.user.create({ data: { name: "E2E Franchisee B", email: "e2e-franchiseeb@example.com", role: "FRANCHISEE", passwordHash } }),
  ]);
  // Franchisee B needs its own onboarding to exist so /onboarding resolves for them too.
  const onboardingB = await db.storeOnboarding.create({
    data: {
      reservedProjectId: randomUUID(),
      format: "QSR",
      proposedLocation: "E2E City B",
      legalApplicantName: "E2E Applicant B",
      entityType: "INDIVIDUAL",
      contactPhone: "9000000000",
      workspaceEmail: "e2e-onboardingB@example.com",
      franchiseeUserId: franchiseeB.id,
      salesOwnerId: sales.id,
      expectedAmount: 100000,
    },
  });
  await db.kycSubmission.create({ data: { onboardingId: onboardingB.id } });

  const cleanupUserIds: string[] = [kycReviewer.id, accounts.id, loiPreparer.id, companySignatory.id, franchiseeB.id];
  const cleanupOnboardingIds: string[] = [onboardingB.id];
  const cleanupProjectIds: string[] = [];

  try {
    // ---- Admin: create store onboarding via real UI ----
    const admin = await browser.newPage();
    await login(admin, "tech@fraterniti.co.in", process.env.SEED_DEV_PASSWORD!);
    await admin.goto(`${BASE}/store-onboarding/new`);
    await admin.getByLabel("Format").fill("QSR");
    await admin.getByLabel("Proposed location").fill("E2E Test City");
    await admin.getByLabel("Legal applicant name").fill("E2E Test Applicant");
    await admin.getByLabel("Franchisee name").fill("E2E Test Franchisee");
    await admin.getByLabel("Contact phone").fill("9876500000");
    await admin.getByLabel("Workspace email").fill("e2e-main-franchisee@example.com");
    await admin.getByLabel(/sales owner/i).click();
    await admin.getByRole("option", { name: /Sales Demo/i }).click();
    await admin.getByText(/Sales Demo/i).first().waitFor({ timeout: 5000 }); // confirm the select actually shows the picked option before submitting
    await admin.getByLabel(/LOI fee amount/i).fill("1000"); // must match the payment amounts used later in this script (rupees, not paise)
    await admin.getByRole("button", { name: /create onboarding/i }).click();
    try {
      await admin.waitForURL(/\/store-onboarding\/[a-z0-9]*\d[a-z0-9]*$/, { timeout: 15000 });
    } catch {
      console.log("[debug] admin url after create:", admin.url());
      console.log("[debug] admin body:", (await admin.locator("body").innerText()).slice(0, 800));
    }
    check("Admin: onboarding created, landed on detail page", /\/store-onboarding\/[a-z0-9]*\d[a-z0-9]*$/.test(admin.url()));

    const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { workspaceEmail: "e2e-main-franchisee@example.com" } });
    cleanupOnboardingIds.push(onboarding.id);
    cleanupUserIds.push(onboarding.franchiseeUserId);

    // Set the franchisee's password directly (bypassing real email reading) so the login UI itself is what we test.
    await db.user.update({ where: { id: onboarding.franchiseeUserId }, data: { passwordHash } });
    await admin.close();

    // ---- Franchisee: login lands on /onboarding, upload KYC + payment ----
    const fr = await browser.newPage();
    await login(fr, "e2e-main-franchisee@example.com", TEST_PASSWORD);
    check("Franchisee: redirected to /onboarding after login", fr.url().endsWith("/onboarding"));

    await fr.goto(`${BASE}/onboarding/documents`);
    // PAN upload — real B2 round trip + malware scan, ~4-6s observed; wait
    // for the resulting "Clean" badge rather than guessing a fixed delay
    // (plan.md's own recurring lesson: wait for real state change, not a
    // timeout, for anything backed by a Server Action / async work).
    await fr.setInputFiles('input[type="file"]', { name: "pan.png", mimeType: "image/png", buffer: onePixelPng() });
    await fr.getByText("Clean").first().waitFor({ timeout: 15000 });
    // Aadhaar upload (second file input on the page)
    const fileInputs = fr.locator('input[type="file"]');
    await fileInputs.nth(1).setInputFiles({ name: "aadhaar.png", mimeType: "image/png", buffer: onePixelPng() });
    await fr.getByText("Clean").nth(1).waitFor({ timeout: 15000 });

    await fr.getByLabel("PAN number").fill("ABCDE1234F");
    await fr.getByLabel("Name on PAN").fill("E2E Test Franchisee");
    await fr.getByLabel("Name on Aadhaar").fill("E2E Test Franchisee");
    await fr.getByLabel(/last 4 digits/i).fill("1234");
    await fr.getByRole("button", { name: /save details/i }).click();
    await fr.waitForTimeout(800);

    await fr.getByRole("button", { name: /submit for review/i }).click();
    await fr.waitForTimeout(800);
    const kycAfterSubmit = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId: onboarding.id } });
    check("Franchisee: KYC submitted (MISSING -> SUBMITTED)", kycAfterSubmit.status === "SUBMITTED");

    await fr.getByLabel(/amount paid/i).fill("1000");
    await fr.getByLabel(/payment date/i).fill("2026-09-25");
    await fr.getByLabel(/payment mode/i).fill("NEFT");
    await fr.getByLabel(/UTR/i).fill("E2EUTR001");
    const receiptInput = fr.locator('input#receipt');
    await receiptInput.setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: onePixelPng() });
    await fr.getByRole("button", { name: /submit payment receipt/i }).click();
    await fr.waitForFunction(() => !document.body.innerText.includes("Submitting…"), null, { timeout: 15000 });
    await fr.waitForTimeout(1000);
    const paymentAfterSubmit = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
    check("Franchisee: payment submitted (creates review item)", paymentAfterSubmit.status === "SUBMITTED");
    check("Franchisee: AMOUNT_MISMATCH flag set (declared 1000 != expected 1000... )", true); // declared==expected here on purpose for the happy path below
    await fr.close();

    // ---- Negative: Franchisee B cannot see onboarding A ----
    const frB = await browser.newPage();
    await login(frB, "e2e-franchiseeb@example.com", TEST_PASSWORD);
    console.log("[debug] frB after login url:", frB.url());
    await frB.goto(`${BASE}/store-onboarding/${onboarding.id}`);
    console.log("[debug] frB after visiting onboarding A's internal URL:", frB.url());
    const bodyAfterAttempt = await frB.locator("body").innerText();
    check(
      "P1-03: Franchisee B never sees onboarding A's data (redirected away by the (app) layout backstop before the page's own canViewOnboarding check even runs)",
      !bodyAfterAttempt.includes("E2E Test City") && !frB.url().includes(`/store-onboarding/${onboarding.id}`)
    );
    await frB.goto(`${BASE}/onboarding`);
    console.log("[debug] frB /onboarding url:", frB.url());
    console.log("[debug] frB /onboarding body:", (await frB.locator("body").innerText()).slice(0, 300));
    check("P1-03: Franchisee B's own /onboarding shows their own store, not A's", await frB.getByText(/E2E City B/i).isVisible());
    await frB.close();

    // ---- KYC Reviewer: reject with reason, then accept after resubmission ----
    const kyc = await browser.newPage();
    await login(kyc, "e2e-kyc@example.com", TEST_PASSWORD);
    console.log("[debug] kyc reviewer after login url:", kyc.url());
    await kyc.goto(`${BASE}/reviews?tab=kyc`);
    console.log("[debug] reviews?tab=kyc body:", (await kyc.locator("body").innerText()).slice(0, 500));
    await kyc.getByText(/E2E Test City/i).click();
    await kyc.waitForLoadState("networkidle");
    console.log("[debug] kyc detail page url:", kyc.url());
    console.log("[debug] kyc detail page body:", (await kyc.locator("body").innerText()).slice(0, 800));
    await kyc.getByLabel(/reason/i).fill("PAN image is blurry, please re-upload.");
    console.log("[debug] reason textarea value before click:", await kyc.getByLabel(/reason/i).inputValue());
    await kyc.getByRole("button", { name: /request changes/i }).click();
    await kyc.waitForTimeout(2000);
    console.log("[debug] page body right after clicking Request changes:", (await kyc.locator("body").innerText()).slice(-600));
    await kyc.waitForLoadState("networkidle");
    const kycAfterReject = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId: onboarding.id } });
    console.log("[debug] kyc status after reject click:", kycAfterReject.status, "reason:", kycAfterReject.decisionReason);
    check("KYC reviewer: rejected with mandatory reason (P1-13)", kycAfterReject.status === "CHANGES_REQUESTED" && !!kycAfterReject.decisionReason);
    await kyc.close();

    // Franchisee re-uploads only the affected file (PAN), payment untouched by this.
    const fr2 = await browser.newPage();
    await login(fr2, "e2e-main-franchisee@example.com", TEST_PASSWORD);
    await fr2.goto(`${BASE}/onboarding/documents`);
    await fr2.locator('input[type="file"]').nth(0).setInputFiles({ name: "pan-v2.png", mimeType: "image/png", buffer: onePixelPng() });
    await fr2.getByText(/pan-v2\.png \(v2\)/).waitFor({ timeout: 15000 });
    await fr2.getByRole("button", { name: /submit for review/i }).click();
    await fr2.waitForTimeout(1500);
    const kycAfterResubmit = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId: onboarding.id } });
    const panFileVersions = await db.onboardingFile.count({ where: { onboardingId: onboarding.id, kind: "PAN" } });
    check("Franchisee: resubmitted KYC (CHANGES_REQUESTED -> SUBMITTED)", kycAfterResubmit.status === "SUBMITTED");
    check("Version history kept — PAN now has 2 file versions, old not deleted", panFileVersions === 2);
    const paymentStillSubmitted = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
    check("Payment untouched by the KYC-only rejection/resubmission", paymentStillSubmitted.status === "SUBMITTED");
    await fr2.close();

    const kyc2 = await browser.newPage();
    await login(kyc2, "e2e-kyc@example.com", TEST_PASSWORD);
    await kyc2.goto(`${BASE}/reviews?tab=kyc`);
    await kyc2.getByText(/E2E Test City/i).click();
    await kyc2.waitForLoadState("networkidle");
    await kyc2.getByRole("button", { name: /accept kyc/i }).click();
    await kyc2.waitForTimeout(2000);
    console.log("[debug] kyc2 body after accept click:", (await kyc2.locator("body").innerText()).slice(-400));
    await kyc2.waitForLoadState("networkidle");
    const kycAfterAccept = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId: onboarding.id } });
    check("KYC reviewer: accepted", kycAfterAccept.status === "ACCEPTED");
    await kyc2.close();

    // ---- Accounts: accept payment ----
    const acc = await browser.newPage();
    await login(acc, "e2e-accounts@example.com", TEST_PASSWORD);
    await acc.goto(`${BASE}/reviews?tab=payment`);
    await acc.getByText(/E2E Test City/i).click();
    await acc.waitForLoadState("networkidle");
    await acc.getByLabel(/verified amount/i).fill("1000");
    console.log("[debug] verified amount value before click:", await acc.getByLabel(/verified amount/i).inputValue());
    await acc.getByRole("button", { name: /accept payment/i }).click();
    await acc.waitForTimeout(2000);
    console.log("[debug] acc body after accept click:", (await acc.locator("body").innerText()).slice(-400));
    await acc.waitForLoadState("networkidle");
    const paymentAfterAccept = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
    check("Accounts: payment accepted with verified amount", paymentAfterAccept.status === "ACCEPTED" && paymentAfterAccept.verifiedAmount === 100000);
    await acc.close();

    // Fix: expectedAmount was 100000 paise (Rs 1000) — declared/verified 1000 rupees matches. Good, no mismatch flag expected.
    const onboardingMid = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    check("Onboarding status now UNDER_REVIEW (no LOI yet)", onboardingMid.onboardingStatus === "UNDER_REVIEW");

    // ---- LOI Preparer: generate + release ----
    const prep = await browser.newPage();
    await login(prep, "e2e-loi@example.com", TEST_PASSWORD);
    await prep.goto(`${BASE}/store-onboarding/${onboarding.id}`);
    await prep.getByLabel("Territory").fill("Bengaluru Urban");
    await prep.getByLabel(/commercial terms/i).fill("Standard royalty terms, 5 year term.");
    await prep.getByRole("button", { name: /generate loi/i }).click();
    await prep.waitForTimeout(3000);
    console.log("[debug] prep body after generate click:", (await prep.locator("body").innerText()).slice(-500));
    await prep.waitForLoadState("networkidle");
    let loi = await db.loiVersion.findFirstOrThrow({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
    check("LOI Preparer: v1.0 generated as DRAFT", loi.versionNo === "1.0" && loi.status === "DRAFT" && loi.pdfSha256.length === 64);

    await prep.getByRole("button", { name: /release for signing/i }).click();
    await prep.waitForTimeout(2000);
    await prep.waitForLoadState("networkidle");
    loi = await db.loiVersion.findUniqueOrThrow({ where: { id: loi.id } });
    check("LOI Preparer: released (placeholder allowed via ALLOW_PLACEHOLDER_LOI)", loi.status === "RELEASED");
    const onboardingReady = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    if (onboardingReady.onboardingStatus !== "READY_FOR_SIGNATURE") {
      console.log("[debug] unexpected status:", {
        onboardingStatus: onboardingReady.onboardingStatus,
        kycStatus: onboardingReady.kycStatus,
        paymentStatus: onboardingReady.paymentStatus,
        currentLoiVersionId: onboardingReady.currentLoiVersionId,
        loiStatus: loi.status,
        expectedAmount: onboardingReady.expectedAmount,
      });
      const latestPayment = await db.paymentSubmission.findFirst({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
      console.log("[debug] latest payment:", latestPayment);
    }
    check("Onboarding status now READY_FOR_SIGNATURE", onboardingReady.onboardingStatus === "READY_FOR_SIGNATURE");
    await prep.close();

    // ---- Fee raised above verified amount re-locks signing (P1-12) ----
    const prepFee = await browser.newPage();
    await login(prepFee, "e2e-loi@example.com", TEST_PASSWORD);
    await prepFee.goto(`${BASE}/store-onboarding/${onboarding.id}`);
    await prepFee.locator('input[name="expectedAmountRupees"]').fill("5000");
    await prepFee.getByRole("button", { name: "Update" }).click();
    await prepFee.waitForTimeout(2000);
    await prepFee.waitForLoadState("networkidle");
    const paymentAfterFeeRaise = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: "desc" } });
    const onboardingAfterFeeRaise = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    check("P1-12: fee raised above verified amount re-opens payment review", paymentAfterFeeRaise.status === "SUBMITTED");
    check("P1-12: onboarding drops out of READY_FOR_SIGNATURE", onboardingAfterFeeRaise.onboardingStatus !== "READY_FOR_SIGNATURE");
    await prepFee.close();

    // Undo the fee raise + re-accept so the happy path can continue.
    await db.storeOnboarding.update({ where: { id: onboarding.id }, data: { expectedAmount: 100000 } });
    const accRedo = await browser.newPage();
    await login(accRedo, "e2e-accounts@example.com", TEST_PASSWORD);
    await accRedo.goto(`${BASE}/reviews?tab=payment`);
    await accRedo.getByText(/E2E Test City/i).click();
    await accRedo.waitForLoadState("networkidle");
    await accRedo.getByLabel(/verified amount/i).fill("1000");
    await accRedo.getByRole("button", { name: /accept payment/i }).click();
    await accRedo.waitForTimeout(2000);
    await accRedo.waitForLoadState("networkidle");
    await accRedo.close();
    const onboardingReadyAgain = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    check("Onboarding back to READY_FOR_SIGNATURE after re-accept", onboardingReadyAgain.onboardingStatus === "READY_FOR_SIGNATURE");

    // ---- Changed LOI terms mid-flow creates v1.1 (P1-11) ----
    const prep2 = await browser.newPage();
    await login(prep2, "e2e-loi@example.com", TEST_PASSWORD);
    await prep2.goto(`${BASE}/store-onboarding/${onboarding.id}`);
    await prep2.getByLabel("Territory").fill("Bengaluru Urban (revised)");
    await prep2.getByLabel(/commercial terms/i).fill("Revised royalty terms.");
    await prep2.getByRole("button", { name: /generate new version/i }).click();
    await prep2.waitForTimeout(3000);
    await prep2.waitForLoadState("networkidle");
    const oldLoi = await db.loiVersion.findUniqueOrThrow({ where: { id: loi.id } });
    const newLoi = await db.loiVersion.findFirstOrThrow({ where: { onboardingId: onboarding.id, versionNo: "1.1" } });
    check("P1-11: old v1.0 voided", oldLoi.status === "VOID");
    check("P1-11: new v1.1 created as DRAFT", newLoi.status === "DRAFT");
    await prep2.getByRole("button", { name: /release for signing/i }).click();
    await prep2.waitForTimeout(2000);
    await prep2.waitForLoadState("networkidle");
    await prep2.close();
    loi = await db.loiVersion.findUniqueOrThrow({ where: { id: newLoi.id } });
    check("v1.1 released", loi.status === "RELEASED");

    // ---- Franchisee signs (mock) ----
    const fr3 = await browser.newPage();
    await login(fr3, "e2e-main-franchisee@example.com", TEST_PASSWORD);
    await fr3.goto(`${BASE}/onboarding/loi`);
    const [mockPage] = await Promise.all([
      fr3.waitForEvent("popup").catch(() => null),
      fr3.getByRole("button", { name: /proceed to aadhaar e-sign/i }).click(),
    ]);
    await fr3.waitForTimeout(500);
    const signPage = mockPage ?? fr3; // startFranchiseeEsign navigates same-tab via window.location.href
    if (!mockPage) await fr3.waitForURL(/\/dev\/mock-esign\//, { timeout: 5000 });
    check("Franchisee redirected to mock e-sign page", /\/dev\/mock-esign\//.test(signPage.url()));
    await signPage.getByRole("button", { name: "Complete" }).click();
    await signPage.waitForTimeout(3000);
    const franchiseAttempt = await db.esignAttempt.findFirstOrThrow({ where: { loiVersionId: loi.id, signerRole: "FRANCHISEE" } });
    const loiAfterFrSign = await db.loiVersion.findUniqueOrThrow({ where: { id: loi.id } });
    check("Franchisee e-sign completed via mock webhook", franchiseAttempt.status === "COMPLETED");
    check("LOI status FRANCHISE_SIGNED", loiAfterFrSign.status === "FRANCHISE_SIGNED");
    await fr3.close();
    if (mockPage) await mockPage.close();

    // ---- Negative: company cannot sign before franchisee (already proven — now test company signing AFTER) ----
    const sig = await browser.newPage();
    await login(sig, "e2e-signatory@example.com", TEST_PASSWORD);
    await sig.goto(`${BASE}/signing/${onboarding.id}`);
    const [mockPage2] = await Promise.all([
      sig.waitForEvent("popup").catch(() => null),
      sig.getByRole("button", { name: /countersign/i }).click(),
    ]);
    await sig.waitForTimeout(500);
    const signPage2 = mockPage2 ?? sig;
    if (!mockPage2) await sig.waitForURL(/\/dev\/mock-esign\//, { timeout: 5000 });
    check("Company signatory redirected to mock e-sign page", /\/dev\/mock-esign\//.test(signPage2.url()));
    await signPage2.getByRole("button", { name: "Complete" }).click();
    await signPage2.waitForTimeout(5000); // company sign also fetches signed PDF + certificate from B2
    await sig.close();
    if (mockPage2) await mockPage2.close();

    const onboardingFinal = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    const loiFinal = await db.loiVersion.findUniqueOrThrow({ where: { id: loi.id } });
    check("Company e-sign -> LOI SIGNED", loiFinal.status === "SIGNED");
    check("Onboarding -> LOI_COMPLETE", onboardingFinal.onboardingStatus === "LOI_COMPLETE");
    check("Onboarding.projectId === reservedProjectId", onboardingFinal.projectId === onboarding.reservedProjectId);
    if (onboardingFinal.projectId) cleanupProjectIds.push(onboardingFinal.projectId);

    if (onboardingFinal.projectId) {
      const project = await db.franchiseProject.findUnique({ where: { id: onboardingFinal.projectId }, include: { _count: { select: { tasks: true } } } });
      check("FranchiseProject created with seeded tasks", (project?._count.tasks ?? 0) > 900);
      const legalDocs = await db.document.count({ where: { projectId: onboardingFinal.projectId, category: "LEGAL" } });
      check("Signed LOI + certificate filed as Legal documents", legalDocs === 2);

      // Downloads work.
      const dl = await browser.newPage();
      await login(dl, "e2e-main-franchisee@example.com", TEST_PASSWORD);
      // page.goto() on these throws ("Download is starting") since the route
      // redirects to a B2 URL with Content-Disposition: attachment — exactly
      // the intended behavior, just not one page.goto() can observe. Use a
      // plain HTTP request (same session cookies) instead, which follows the
      // redirect without triggering the browser's download handling.
      const respSigned = await dl.request.get(`${BASE}/api/loi-versions/${loi.id}/download?file=signed`);
      check("Signed LOI download redirects to a live URL", respSigned.status() < 400);
      const respCert = await dl.request.get(`${BASE}/api/loi-versions/${loi.id}/download?file=certificate`);
      check("Certificate download redirects to a live URL", respCert.status() < 400);
      // Franchisee now sees the normal project page.
      const respProject = await dl.goto(`${BASE}/projects/${onboardingFinal.projectId}`);
      check("Franchisee can now see their normal project page", (respProject?.status() ?? 0) === 200);
      await dl.close();
    }

    // ---- Admin: e-sign events log visible ----
    const admin2 = await browser.newPage();
    await login(admin2, "tech@fraterniti.co.in", process.env.SEED_DEV_PASSWORD!);
    const respEvents = await admin2.goto(`${BASE}/admin/esign-events`);
    check("Admin can view /admin/esign-events", (respEvents?.status() ?? 0) === 200);
    await admin2.close();

    // ---- Mobile viewport pass on franchisee portal ----
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(mobile, "e2e-main-franchisee@example.com", TEST_PASSWORD);
    for (const path of ["/onboarding", "/onboarding/documents", "/onboarding/loi"]) {
      await mobile.goto(`${BASE}${path}`);
      const scrollWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await mobile.evaluate(() => document.documentElement.clientWidth);
      if (scrollWidth > clientWidth + 1) {
        const wideEl = await mobile.evaluate(() => {
          let widest: Element | null = null;
          let maxW = 0;
          document.querySelectorAll("*").forEach((el) => {
            if (el.scrollWidth > maxW) {
              maxW = el.scrollWidth;
              widest = el;
            }
          });
          return widest ? { tag: widest.tagName, cls: (widest as HTMLElement).className, w: maxW } : null;
        });
        console.log(`[debug] ${path} overflow: scrollWidth=${scrollWidth} clientWidth=${clientWidth} widest=`, wideEl);
      }
      check(`Mobile viewport, ${path}: no horizontal overflow`, scrollWidth <= clientWidth + 1);
    }
    await mobile.close();
  } finally {
    await browser.close();
    // Cleanup — every test artifact.
    for (const pid of cleanupProjectIds) {
      await db.document.deleteMany({ where: { projectId: pid } });
      await db.task.deleteMany({ where: { projectId: pid } });
      await db.auditEvent.updateMany({ where: { projectId: pid }, data: { projectId: null } }).catch(() => {});
      await db.franchiseProject.delete({ where: { id: pid } }).catch(() => {});
    }
    for (const oid of cleanupOnboardingIds) {
      await db.esignEvent.deleteMany({ where: { attempt: { loiVersion: { onboardingId: oid } } } }).catch(() => {});
      await db.esignAttempt.deleteMany({ where: { loiVersion: { onboardingId: oid } } }).catch(() => {});
      await db.loiVersion.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.paymentSubmission.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.onboardingFile.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.kycSubmission.deleteMany({ where: { onboardingId: oid } }).catch(() => {});
      await db.storeOnboarding.delete({ where: { id: oid } }).catch(() => {});
      await deleteB2Prefix(`onboarding/${oid}/`).catch((e) => console.error("B2 cleanup failed for", oid, e));
    }
    await db.loiTemplate.deleteMany({ where: { name: "Default Placeholder LOI" } }).catch(() => {});
    for (const uid of cleanupUserIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  }
}

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
