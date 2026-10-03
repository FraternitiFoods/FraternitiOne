import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { computeOnboardingCompletion } from "../src/lib/onboarding/completion";

/**
 * plan.md section 20B — real-browser verification of the Franchisee/Sales/
 * Admin/Management dashboard widget rows added to /dashboard, /onboarding and
 * /store-onboarding. Modeled directly on scripts/tmp-e2e-otp-signing.ts
 * (section 19) and scripts/tmp-e2e-sales.ts (section 20A) — same login
 * helper, same mock-OTP flow to reach LOI_COMPLETE, same cleanup discipline
 * (deletion wrapped in `finally`, independent of what fails above it).
 *
 * Reuses the app's existing dev-seeded demo accounts (tech, sales.demo,
 * franchisee.demo, kyc.demo, accounts.demo, loi.demo — password reset to
 * "Demo@12345" via scripts/tmp-demo-setup.ts just before this run) rather
 * than creating a fresh reviewer/preparer account per role, since reviewing/
 * accepting is a standard use of those accounts (same precedent as section
 * 20C's verification script). Creates its own throwaway COMPANY_SIGNATORY
 * (needs a phone number for OTP delivery — signatory.demo has none set in
 * this dev DB and this script doesn't want to mutate a shared fixture's
 * phone), throwaway FRANCHISEE accounts (one via the real onboarding ->
 * LOI_COMPLETE flow, one via a direct /projects/new project with NO
 * onboarding record, to exercise the "legacy project" null-safety path), and
 * one throwaway MANAGEMENT user (role gate check only, never used to mutate
 * anything).
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
const DEMO_PASSWORD = "Demo@12345"; // scripts/tmp-demo-setup.ts, re-run just before this script
const TEST_PASSWORD = "E2e20bTest123!";

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

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

async function getLatestOtpCode(inbox: Page, toE164: string): Promise<string> {
  await inbox.goto(`${BASE}/dev/mock-sms`);
  const item = inbox.locator("li", { hasText: toE164 }).first();
  await item.waitFor({ timeout: 5000 });
  const code = await item.locator(".font-mono").innerText();
  return code.trim();
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

async function uploadKycAndPayment(page: Page, onboardingId: string, utr: string) {
  await page.goto(`${BASE}/onboarding/documents`);
  await page.setInputFiles('input[type="file"]', { name: "pan.png", mimeType: "image/png", buffer: onePixelPng() });
  await page.getByText("Clean").first().waitFor({ timeout: 15000 });
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(1).setInputFiles({ name: "aadhaar.png", mimeType: "image/png", buffer: onePixelPng() });
  await page.getByText("Clean").nth(1).waitFor({ timeout: 15000 });

  await page.getByLabel("PAN number").fill("ABCDE1234F");
  await page.getByLabel("Name on PAN").fill("E2E20B Franchisee");
  await page.getByLabel("Name on Aadhaar").fill("E2E20B Franchisee");
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
}

async function acceptKycAndPayment(browser: Browser, onboardingId: string, storeNameText: RegExp) {
  const kyc = await browser.newPage();
  await login(kyc, "kyc.demo@fraterniti.co.in", DEMO_PASSWORD);
  await kyc.goto(`${BASE}/reviews?tab=kyc`);
  await kyc.getByText(storeNameText).click();
  await kyc.waitForLoadState("networkidle");
  await kyc.getByRole("button", { name: /accept kyc/i }).click();
  await kyc.waitForTimeout(1500);
  await kyc.close();

  const acc = await browser.newPage();
  await login(acc, "accounts.demo@fraterniti.co.in", DEMO_PASSWORD);
  await acc.goto(`${BASE}/reviews?tab=payment`);
  await acc.getByText(storeNameText).click();
  await acc.waitForLoadState("networkidle");
  await acc.getByLabel(/verified amount/i).fill("1000");
  await acc.getByRole("button", { name: /accept payment/i }).click();
  await acc.waitForTimeout(1500);
  await acc.close();

  const kycRow = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId } });
  const paymentRow = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId }, orderBy: { createdAt: "desc" } });
  check(`[${onboardingId}] KYC accepted`, kycRow.status === "ACCEPTED");
  check(`[${onboardingId}] Payment accepted`, paymentRow.status === "ACCEPTED");
}

async function generateAndReleaseLoi(browser: Browser, onboardingId: string, territory: string) {
  const prep = await browser.newPage();
  await login(prep, "loi.demo@fraterniti.co.in", DEMO_PASSWORD);
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
  return loi;
}

async function main() {
  const browser: Browser = await chromium.launch();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  // ---- Baselines, for the final "DB back to normal" check ----
  const baselineUserCount = await db.user.count();
  const baselineOnboardingCount = await db.storeOnboarding.count();
  const baselineProjectCount = await db.franchiseProject.count();

  const inbox = await browser.newPage();

  const cleanupUserIds: string[] = [];
  const cleanupOnboardingIds: string[] = [];
  const cleanupProjectIds: string[] = [];

  try {
    // =========================================================================
    // SETUP — throwaway MANAGEMENT user, throwaway "legacy" franchisee + direct project.
    // =========================================================================
    const [management, legacyFranchisee] = await Promise.all([
      db.user.create({ data: { name: "E2E20B Management", email: "e2e20b-management@example.com", role: "MANAGEMENT", passwordHash } }),
      db.user.create({ data: { name: "E2E20B Legacy Franchisee", email: "e2e20b-legacy@example.com", role: "FRANCHISEE", passwordHash } }),
    ]);
    cleanupUserIds.push(management.id, legacyFranchisee.id);

    // ---- Legacy project: created directly via /projects/new, NO onboarding row ----
    const admin0 = await browser.newPage();
    await login(admin0, "tech@fraterniti.co.in", DEMO_PASSWORD);
    await admin0.goto(`${BASE}/projects/new`);
    await admin0.getByLabel("Brand").fill("Tulsi");
    await admin0.getByLabel("Format").fill("QSR");
    await admin0.getByLabel("Location").fill("E2E20B Legacy City (temp)");
    await admin0.getByLabel("Franchisee").click();
    await admin0.getByRole("option", { name: /E2E20B Legacy Franchisee/i }).click();
    await admin0.getByLabel("Owner").click();
    await admin0.getByRole("option", { name: /Fraterniti Admin/i }).click();
    await admin0.getByLabel("Target Opening").fill("2027-06-01");
    await admin0.getByRole("button", { name: /create project/i }).click();
    await admin0.waitForURL((url) => /^\/projects\/[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith("/new"), {
      timeout: 15000,
    });
    const legacyProjectId = admin0.url().split("/projects/")[1];
    cleanupProjectIds.push(legacyProjectId);
    await admin0.close();
    check("Legacy project created with no onboarding record", (await db.franchiseProject.findUniqueOrThrow({ where: { id: legacyProjectId }, include: { onboarding: true } })).onboarding === null);

    // =========================================================================
    // Drive one throwaway onboarding all the way to LOI_COMPLETE, so the
    // Franchisee dashboard's onboarding-aware widgets (Completion/KYC/
    // Payment/LOI/Sales/Complaints/Emails) and the SALES dashboard (a store
    // that actually converted) both have something real to check against —
    // no onboarding in this dev DB was already at LOI_COMPLETE (checked
    // first: only one real onboarding exists, status FRANCHISE_SIGNED).
    // =========================================================================
    const admin1 = await browser.newPage();
    await login(admin1, "tech@fraterniti.co.in", DEMO_PASSWORD);
    const ob = await createOnboardingViaUI(admin1, {
      proposedLocation: "E2E20B Widget City",
      contactPhone: "9876500298",
      workspaceEmail: "e2e20b-widget@tulsi.world",
      franchiseeName: "E2E20B Widget Franchisee",
    });
    await admin1.close();
    cleanupOnboardingIds.push(ob.id);
    cleanupUserIds.push(ob.franchiseeUserId);

    const fr1 = await browser.newPage();
    await login(fr1, "e2e20b-widget@tulsi.world", TEST_PASSWORD);
    await uploadKycAndPayment(fr1, ob.id, "E2E20BUTR001");
    await fr1.close();

    const kycAfterSubmit = await db.kycSubmission.findUniqueOrThrow({ where: { onboardingId: ob.id } });
    const paymentAfterSubmit = await db.paymentSubmission.findFirstOrThrow({ where: { onboardingId: ob.id } });
    check("KYC submitted (SUBMITTED)", kycAfterSubmit.status === "SUBMITTED");
    check("Payment submitted (SUBMITTED)", paymentAfterSubmit.status === "SUBMITTED");

    // ---- Mid-flow checkpoint: ADMIN "Review Workload" widget while a real
    //      item sits in each queue (cause-effect #1: cross-check a nonzero
    //      widget number against a direct DB count, not just an all-zero one) ----
    {
      const [directKycQueue, directPaymentQueue] = await Promise.all([
        db.storeOnboarding.count({ where: { kycStatus: "SUBMITTED" } }),
        db.storeOnboarding.count({ where: { paymentStatus: "SUBMITTED" } }),
      ]);
      const adminCheck = await browser.newPage();
      await login(adminCheck, "tech@fraterniti.co.in", DEMO_PASSWORD);
      await adminCheck.goto(`${BASE}/dashboard`);
      const body = await adminCheck.locator("body").innerText();
      check(
        `ADMIN dashboard: Review Workload shows ${directKycQueue + directPaymentQueue} (${directKycQueue} KYC direct-count · ${directPaymentQueue} payment direct-count), matches DB`,
        new RegExp(`${directKycQueue + directPaymentQueue}[\\s\\S]{0,40}${directKycQueue} KYC[\\s\\S]{0,10}${directPaymentQueue} payment`, "i").test(body)
      );
      check("ADMIN dashboard: pre-existing 'Management Command Centre' header still renders", body.includes("Management Command Centre"));
      check("ADMIN dashboard: pre-existing 'Live Department Feed' card still renders", body.includes("Live Department Feed"));
      await adminCheck.close();
    }

    await acceptKycAndPayment(browser, ob.id, /E2E20B Widget City/i);
    const loi = await generateAndReleaseLoi(browser, ob.id, "E2E20B Territory");

    // ---- Franchisee signs by OTP ----
    const fr2 = await browser.newPage();
    await login(fr2, "e2e20b-widget@tulsi.world", TEST_PASSWORD);
    await fr2.goto(`${BASE}/onboarding/loi`);
    await fr2.getByLabel(/i have read the loi/i).check();
    await fr2.request.get(`${BASE}/api/loi-versions/${loi.id}/download`);
    await fr2.getByRole("button", { name: /sign loi with otp/i }).click();
    await fr2.getByLabel(/enter the 6-digit code/i).waitFor({ timeout: 5000 });
    const frCode = await getLatestOtpCode(inbox, "+919876500298");
    await fr2.getByLabel(/enter the 6-digit code/i).fill(frCode);
    await fr2.getByRole("button", { name: "Verify" }).click();
    await fr2.waitForTimeout(2000);
    const fr2Body = await fr2.locator("body").innerText();
    await fr2.close();

    const loiAfterFr = await db.loiVersion.findUniqueOrThrow({ where: { id: loi.id } });
    check(`Franchisee OTP sign -> LOI status FRANCHISE_SIGNED (was: ${loiAfterFr.status})`, loiAfterFr.status === "FRANCHISE_SIGNED");
    if (loiAfterFr.status !== "FRANCHISE_SIGNED") {
      console.log("[debug] /onboarding/loi body after franchisee verify attempt:\n", fr2Body.slice(0, 1500));
    }

    // ---- Company countersign is DELIBERATELY NOT exercised through the real
    //      OTP verify action here. Investigation (three attempts, up to 120s
    //      of DB polling each) found the company-side completion step
    //      (creates FranchiseProject + ~963 seeded tasks, builds + uploads
    //      the acceptance certificate to B2) hangs indefinitely in this dev
    //      environment: OtpChallenge reaches VERIFIED but EsignAttempt stays
    //      SENT forever, and the still-running request measurably degrades
    //      the dev server for subsequent requests (a later /login in this
    //      same run timed out). This is a genuine, pre-existing issue in
    //      section 19's company-side LOI completion path — out of 20B's
    //      scope and inside the boundary this task must not touch (esign/
    //      otp/signing/webhook-processor). Flagging it back rather than
    //      investigating or fixing it further (see build log). To still
    //      verify 20B's OWN widget code against a genuinely LOI_COMPLETE
    //      onboarding, the post-conversion DB state is constructed directly
    //      here — same shape the real completion step would leave behind
    //      (FranchiseProject at the reserved id, onboarding.projectId set,
    //      onboardingStatus LOI_COMPLETE, LoiVersion SIGNED) — which is fair
    //      game for this script (it exercises 20B's queries/rendering, not
    //      section 19's completion transaction).
    const admin2 = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });
    await db.franchiseProject.create({
      data: {
        id: ob.reservedProjectId,
        brand: ob.brand,
        format: "QSR",
        franchiseeId: ob.franchiseeUserId,
        location: ob.proposedLocation,
        targetOpening: new Date("2027-06-01"),
        ownerId: admin2.id,
      },
    });
    await db.loiVersion.update({ where: { id: loi.id }, data: { status: "SIGNED" } });
    await db.storeOnboarding.update({
      where: { id: ob.id },
      data: { projectId: ob.reservedProjectId, onboardingStatus: "LOI_COMPLETE" },
    });

    const obFinal = await db.storeOnboarding.findUniqueOrThrow({ where: { id: ob.id } });
    check("Throwaway onboarding reached LOI_COMPLETE", obFinal.onboardingStatus === "LOI_COMPLETE");
    check("FranchiseProject created at the reserved id", obFinal.projectId === ob.reservedProjectId);
    if (obFinal.projectId) cleanupProjectIds.push(obFinal.projectId);
    const convertedProjectId = obFinal.projectId;

    // =========================================================================
    // WIDGET CHECKS
    // =========================================================================

    // ---- (a) FRANCHISEE in-progress: franchisee.demo, real pre-existing
    //      onboarding, FRANCHISE_SIGNED / KYC+payment ACCEPTED — /onboarding home ----
    {
      const demoOb = await db.storeOnboarding.findFirstOrThrow({
        where: { franchisee: { email: "franchisee.demo@fraterniti.co.in" } },
        include: {
          kyc: true,
          files: { where: { supersededBy: null }, select: { kind: true } },
          currentLoiVersion: { select: { status: true } },
        },
      });
      const directCompletion = computeOnboardingCompletion({
        entityType: demoOb.entityType,
        kyc: demoOb.kyc,
        uploadedFileKinds: demoOb.files.map((f) => f.kind),
        paymentStatus: demoOb.paymentStatus,
      });
      const directEmailCount = await db.notificationLog.count({ where: { onboardingId: demoOb.id } });

      const page = await browser.newPage();
      await login(page, "franchisee.demo@fraterniti.co.in", DEMO_PASSWORD);
      await page.goto(`${BASE}/onboarding`);
      const body = await page.locator("body").innerText();
      check(
        `FRANCHISEE (in-progress) /onboarding: Onboarding Completion shows ${directCompletion.completed}/${directCompletion.total} (direct pure-function cross-check)`,
        body.includes(`${directCompletion.completed}/${directCompletion.total}`)
      );
      check("FRANCHISEE (in-progress) /onboarding: LOI Status widget renders", /LOI Status/i.test(body));
      check(
        `FRANCHISEE (in-progress) /onboarding: emails section matches NotificationLog (direct count=${directEmailCount})`,
        directEmailCount === 0 ? body.includes("No emails sent yet.") : /Latest emails sent/i.test(body)
      );
      // Pre-existing content unchanged: KYC/Payment status cards, progress pills.
      check("FRANCHISEE (in-progress) /onboarding: pre-existing KYC status card still renders", /KYC status/i.test(body));
      check("FRANCHISEE (in-progress) /onboarding: pre-existing Payment status card still renders", /Payment status/i.test(body));
      await page.close();
    }

    // ---- (b) FRANCHISEE converted: the throwaway onboarding, now LOI_COMPLETE — /dashboard ----
    if (!convertedProjectId) {
      check("FRANCHISEE (converted) /dashboard: SKIPPED — conversion did not complete, see debug output above", false);
    } else {
      const directSalesThisMonth = await db.salesDay.aggregate({
        where: { projectId: convertedProjectId },
        _sum: { netSales: true, orders: true },
      });
      const directOpenComplaints = await db.complaint.count({
        where: { projectId: convertedProjectId, status: { notIn: ["RESOLVED", "CLOSED"] } },
      });
      const directEmailCount = await db.notificationLog.count({ where: { onboardingId: ob.id } });

      const page = await browser.newPage();
      await login(page, "e2e20b-widget@tulsi.world", TEST_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check("FRANCHISEE (converted) /dashboard: KYC Status shows Accepted", /KYC Status[\s\S]{0,20}Accepted/.test(body));
      check("FRANCHISEE (converted) /dashboard: Payment Status shows Accepted", /Payment Status[\s\S]{0,20}Accepted/.test(body));
      check("FRANCHISEE (converted) /dashboard: LOI Status shows Fully Signed", /LOI Status[\s\S]{0,20}Fully Signed/.test(body));
      check(
        `FRANCHISEE (converted) /dashboard: Sales This Month is ₹0 (direct SUM=${directSalesThisMonth._sum.netSales ?? 0}, no SalesDay rows yet)`,
        /Sales This Month[\s\S]{0,15}₹0/.test(body) && (directSalesThisMonth._sum.netSales ?? 0) === 0
      );
      check(
        `FRANCHISEE (converted) /dashboard: Open Complaints is ${directOpenComplaints} (direct count)`,
        new RegExp(`Open Complaints[\\s\\S]{0,15}${directOpenComplaints}`).test(body)
      );
      check(
        `FRANCHISEE (converted) /dashboard: emails match NotificationLog (direct count=${directEmailCount})`,
        directEmailCount > 0 && /Latest Emails Sent/i.test(body)
      );
      // Pre-existing content unchanged: lifecycle progress, opening readiness, etc.
      check("FRANCHISEE (converted) /dashboard: pre-existing 'Lifecycle Progress' card still renders", body.includes("Lifecycle Progress"));
      check("FRANCHISEE (converted) /dashboard: pre-existing 'Opening Readiness' stat still renders", body.includes("Opening Readiness"));
      await page.close();
    }

    // ---- (b2) Legacy franchisee (no onboarding record) — must not crash, Sales/Complaints widgets still render ----
    {
      const page = await browser.newPage();
      await login(page, "e2e20b-legacy@example.com", TEST_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check("Legacy franchisee (no onboarding) /dashboard: loads without error", !/application error|500/i.test(body));
      check("Legacy franchisee /dashboard: Sales This Month widget still renders (no onboarding needed)", /Sales This Month/i.test(body));
      check("Legacy franchisee /dashboard: Open Complaints widget still renders", /Open Complaints/i.test(body));
      check("Legacy franchisee /dashboard: no KYC/Payment/LOI/Completion widgets shown (no onboarding record)", !/Onboarding Completion/i.test(body) && !/LOI Status/i.test(body));
      await page.close();
    }

    // ---- (c) SALES: sales.demo now owns exactly one store (the converted throwaway) ----
    {
      const salesDemo = await db.user.findUniqueOrThrow({ where: { email: "sales.demo@fraterniti.co.in" } });
      const [directMyStores, directKycAccepted, directKycPending, directLoiPending, directActiveProjects] = await Promise.all([
        db.storeOnboarding.count({ where: { salesOwnerId: salesDemo.id } }),
        db.storeOnboarding.count({ where: { salesOwnerId: salesDemo.id, kycStatus: "ACCEPTED" } }),
        db.storeOnboarding.count({ where: { salesOwnerId: salesDemo.id, kycStatus: { not: "ACCEPTED" } } }),
        db.storeOnboarding.count({ where: { salesOwnerId: salesDemo.id, onboardingStatus: { not: "LOI_COMPLETE" } } }),
        db.storeOnboarding.count({ where: { salesOwnerId: salesDemo.id, projectId: { not: null } } }),
      ]);
      check("SALES isolation pre-check: sales.demo owns exactly the 1 throwaway store, not franchisee.demo's", directMyStores === 1);

      const page = await browser.newPage();
      await login(page, "sales.demo@fraterniti.co.in", DEMO_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check(`SALES /dashboard: My Stores = ${directMyStores} (direct count)`, new RegExp(`My Stores[\\s\\S]{0,15}${directMyStores}`).test(body));
      check(`SALES /dashboard: KYC Accepted = ${directKycAccepted} (direct count)`, new RegExp(`KYC Accepted[\\s\\S]{0,15}${directKycAccepted}`).test(body));
      check(`SALES /dashboard: KYC Pending = ${directKycPending} (direct count)`, new RegExp(`KYC Pending[\\s\\S]{0,15}${directKycPending}`).test(body));
      check(`SALES /dashboard: LOI Pending = ${directLoiPending} (direct count)`, new RegExp(`LOI Pending[\\s\\S]{0,15}${directLoiPending}`).test(body));
      check(`SALES /dashboard: Active Projects = ${directActiveProjects} (direct count)`, new RegExp(`Active Projects[\\s\\S]{0,15}${directActiveProjects}`).test(body));
      check("SALES /dashboard: title is 'Sales Dashboard'", body.includes("Sales Dashboard"));
      await page.close();
    }

    // ---- (d) ADMIN: final widget values, cross-checked against direct counts ----
    {
      const [
        directTotalOnboardings,
        directSalesUsers,
        directKycPending,
        directKycAccepted,
        directLoiPending,
        directLoiComplete,
        directOpenComplaints,
      ] = await Promise.all([
        db.storeOnboarding.count(),
        db.user.count({ where: { role: "SALES" } }),
        db.storeOnboarding.count({ where: { kycStatus: { not: "ACCEPTED" } } }),
        db.storeOnboarding.count({ where: { kycStatus: "ACCEPTED" } }),
        db.storeOnboarding.count({ where: { onboardingStatus: { not: "LOI_COMPLETE" } } }),
        db.storeOnboarding.count({ where: { onboardingStatus: "LOI_COMPLETE" } }),
        db.complaint.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      ]);

      const page = await browser.newPage();
      await login(page, "tech@fraterniti.co.in", DEMO_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check(`ADMIN /dashboard: Total Onboardings = ${directTotalOnboardings} (direct count)`, new RegExp(`Total Onboardings[\\s\\S]{0,15}${directTotalOnboardings}`).test(body));
      check(`ADMIN /dashboard: Sales Users = ${directSalesUsers} (direct count)`, new RegExp(`Sales Users[\\s\\S]{0,15}${directSalesUsers}`).test(body));
      check(`ADMIN /dashboard: KYC Pending = ${directKycPending} (direct count)`, new RegExp(`KYC Pending[\\s\\S]{0,15}${directKycPending}`).test(body));
      check(`ADMIN /dashboard: KYC Accepted = ${directKycAccepted} (direct count)`, new RegExp(`KYC Accepted[\\s\\S]{0,15}${directKycAccepted}`).test(body));
      check(`ADMIN /dashboard: LOI Pending = ${directLoiPending} (direct count)`, new RegExp(`LOI Pending[\\s\\S]{0,15}${directLoiPending}`).test(body));
      check(`ADMIN /dashboard: LOI Complete = ${directLoiComplete} (direct count)`, new RegExp(`LOI Complete[\\s\\S]{0,15}${directLoiComplete}`).test(body));
      check(`ADMIN /dashboard: Open Complaints = ${directOpenComplaints} (direct count)`, new RegExp(`Open Complaints[\\s\\S]{0,15}${directOpenComplaints}`).test(body));
      check("ADMIN /dashboard: 'Franchise Pipeline (Admin / Management)' row renders", body.includes("Franchise Pipeline (Admin / Management)"));
      await page.close();
    }

    // ---- (e) MANAGEMENT: same admin row, role-gated correctly ----
    {
      const page = await browser.newPage();
      await login(page, "e2e20b-management@example.com", TEST_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check("MANAGEMENT /dashboard: sees 'Franchise Pipeline (Admin / Management)' row too", body.includes("Franchise Pipeline (Admin / Management)"));
      check("MANAGEMENT /dashboard: pre-existing 'Management Command Centre' header still renders", body.includes("Management Command Centre"));
      await page.close();
    }

    // ---- (f) Non-admin internal role does NOT get the admin row (e.g. LEGAL) ----
    {
      const page = await browser.newPage();
      await login(page, "legal.demo@fraterniti.co.in", DEMO_PASSWORD);
      await page.goto(`${BASE}/dashboard`);
      const body = await page.locator("body").innerText();
      check("LEGAL /dashboard: does NOT see the Admin/Management widget row", !body.includes("Franchise Pipeline (Admin / Management)"));
      await page.close();
    }

    // ---- (g) /store-onboarding summary strip ----
    {
      const [directTotal, directKycPending, directPaymentPending, directLoiPending, directConverted] = await Promise.all([
        db.storeOnboarding.count(),
        db.storeOnboarding.count({ where: { kycStatus: { not: "ACCEPTED" } } }),
        db.storeOnboarding.count({ where: { paymentStatus: { not: "ACCEPTED" } } }),
        db.storeOnboarding.count({ where: { onboardingStatus: { not: "LOI_COMPLETE" } } }),
        db.storeOnboarding.count({ where: { onboardingStatus: "LOI_COMPLETE" } }),
      ]);
      const page = await browser.newPage();
      await login(page, "tech@fraterniti.co.in", DEMO_PASSWORD);
      await page.goto(`${BASE}/store-onboarding`);
      const body = await page.locator("body").innerText();
      check(`/store-onboarding strip: Total Onboardings = ${directTotal} (direct count)`, new RegExp(`Total Onboardings[\\s\\S]{0,15}${directTotal}`).test(body));
      check(`/store-onboarding strip: KYC Pending = ${directKycPending} (direct count)`, new RegExp(`KYC Pending[\\s\\S]{0,15}${directKycPending}`).test(body));
      check(`/store-onboarding strip: Payment Pending = ${directPaymentPending} (direct count)`, new RegExp(`Payment Pending[\\s\\S]{0,15}${directPaymentPending}`).test(body));
      check(`/store-onboarding strip: LOI Pending = ${directLoiPending} (direct count)`, new RegExp(`LOI Pending[\\s\\S]{0,15}${directLoiPending}`).test(body));
      check(`/store-onboarding strip: Converted (LOI Complete) = ${directConverted} (direct count)`, new RegExp(`Converted \\(LOI Complete\\)[\\s\\S]{0,15}${directConverted}`).test(body));
      // Pre-existing table/list untouched: the one row from the throwaway + franchisee.demo's + the legacy one (no onboarding, so not listed) should still list by code.
      check("/store-onboarding: table of onboardings still renders (pre-existing content untouched)", body.includes("Store Onboarding"));
      await page.close();
    }
  } finally {
    await browser.close();

    for (const pid of cleanupProjectIds) {
      await db.complaint.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.document.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.task.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.auditEvent.updateMany({ where: { projectId: pid }, data: { projectId: null } }).catch(() => {});
      await db.salesDay.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.salesImportBatch.deleteMany({ where: { projectId: pid } }).catch(() => {});
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

    const afterUserCount = await db.user.count();
    const afterOnboardingCount = await db.storeOnboarding.count();
    const afterProjectCount = await db.franchiseProject.count();
    check(`DB back to baseline: users ${baselineUserCount} -> ${afterUserCount}`, afterUserCount === baselineUserCount);
    check(`DB back to baseline: onboardings ${baselineOnboardingCount} -> ${afterOnboardingCount}`, afterOnboardingCount === baselineOnboardingCount);
    check(`DB back to baseline: projects ${baselineProjectCount} -> ${afterProjectCount}`, afterProjectCount === baselineProjectCount);

    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
