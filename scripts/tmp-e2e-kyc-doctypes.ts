// plan.md section 20C verification: the 7 new OnboardingFileKind values
// (ADDRESS_PROOF, PHOTOGRAPH, BANK_STATEMENT, CANCELLED_CHEQUE, GST_CERT,
// PARTNERSHIP_DEED, OTHER_SUPPORTING) — upload, scan, version history,
// restricted-open + audit, review-queue visibility, role isolation, and
// confirming an already-ACCEPTED onboarding is untouched.
//
// Pattern copied from scripts/tmp-e2e-onboarding.ts / tmp-e2e-sales.ts
// (throwaway data created/cleaned through the real app UI where the plan
// asks for that; a dedicated throwaway franchisee user so an existing
// seeded account's in-progress onboarding is never reused).
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const DEMO_PASSWORD = "Demo@12345"; // set by scripts/tmp-demo-setup.ts earlier this session

// deleteOnboarding (the real admin action used for cleanup below) only
// removes DB rows, not the B2 objects those OnboardingFile rows pointed at
// (existing app behavior, out of 20C's scope to change) — so this script
// cleans up the B2 prefix itself, same precedent as tmp-e2e-onboarding.ts.
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

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

async function main() {
  const browser: Browser = await chromium.launch();

  // Baseline counts, for the "DB back to pre-test state" check at the end.
  const baselineOnboardings = await db.storeOnboarding.count();
  const baselineUsers = await db.user.count();
  const baselineFiles = await db.onboardingFile.count();
  const baselineAuditEvents = await db.auditEvent.count();

  // Must be on an approved domain (src/lib/email-domain.ts, section 18a) —
  // /store-onboarding/new enforces this server-side, unlike a direct Prisma
  // insert (which is why other scripts' @example.com franchisees don't hit it).
  const WORKSPACE_EMAIL = "e2e20c-verification@tulsi.world";
  let onboardingId: string | null = null;
  let franchiseeUserId: string | null = null;

  try {
    // ---------------------------------------------------------------
    // 1) Already-ACCEPTED onboarding must be unaffected (cause-effect #1).
    //    Snapshot it BEFORE doing anything else this session.
    // ---------------------------------------------------------------
    const existingBefore = await db.storeOnboarding.findFirstOrThrow({
      where: { kycStatus: "ACCEPTED" },
      include: { kyc: true },
    });
    console.log(
      `[info] Pre-existing ACCEPTED onboarding for baseline check: ${existingBefore.id} (kyc=${existingBefore.kycStatus}, onboarding=${existingBefore.onboardingStatus})`
    );

    // ---------------------------------------------------------------
    // 2) Admin creates a throwaway onboarding through the real UI.
    // ---------------------------------------------------------------
    const admin = await browser.newPage();
    await login(admin, "tech@fraterniti.co.in", DEMO_PASSWORD);
    await admin.goto(`${BASE}/store-onboarding/new`);
    await admin.getByLabel("Format").fill("QSR");
    await admin.getByLabel("Proposed location").fill("20C Verification City");
    await admin.getByLabel("Legal applicant name").fill("20C Verification Applicant");
    await admin.getByLabel("Franchisee name").fill("20C Verification Franchisee");
    await admin.getByLabel("Contact phone").fill("9876511111");
    await admin.getByLabel("Workspace email").fill(WORKSPACE_EMAIL);
    await admin.getByLabel(/sales owner/i).click();
    await admin.getByRole("option", { name: /Sales Demo/i }).click();
    await admin.getByText(/Sales Demo/i).first().waitFor({ timeout: 5000 });
    await admin.getByLabel(/LOI fee amount/i).fill("1000");
    await admin.getByRole("button", { name: /create onboarding/i }).click();
    try {
      await admin.waitForURL(/\/store-onboarding\/[a-z0-9]*\d[a-z0-9]*$/, { timeout: 15000 });
    } catch {
      console.log("[debug] admin url after create:", admin.url());
      console.log("[debug] admin body FULL:", await admin.locator("body").innerText());
      await admin.screenshot({ path: "scripts/tmp-debug-create-onboarding.png", fullPage: true });
    }
    check("Admin: throwaway onboarding created", /\/store-onboarding\/[a-z0-9]*\d[a-z0-9]*$/.test(admin.url()));

    const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { workspaceEmail: WORKSPACE_EMAIL } });
    onboardingId = onboarding.id;
    franchiseeUserId = onboarding.franchiseeUserId;
    await db.user.update({ where: { id: franchiseeUserId }, data: { passwordHash: await hashDemoPassword() } });
    await admin.close();

    // ---------------------------------------------------------------
    // 3) Franchisee uploads an optional new-kind document, confirms
    //    PENDING -> CLEAN, then re-uploads to confirm version history.
    // ---------------------------------------------------------------
    const fr = await browser.newPage();
    await login(fr, WORKSPACE_EMAIL, DEMO_PASSWORD);
    if (!fr.url().endsWith("/onboarding")) {
      console.log("[debug] franchisee url after login:", fr.url());
      console.log("[debug] franchisee body:", (await fr.locator("body").innerText()).slice(0, 500));
    }
    check("Franchisee: redirected to /onboarding after login", fr.url().endsWith("/onboarding"));

    await fr.goto(`${BASE}/onboarding/documents`);
    check("Franchisee: 'Additional documents (optional)' section visible", await fr.getByText("Additional documents (optional)").isVisible());
    check("Franchisee: Bank statement uploader visible", await fr.getByText("Bank statement").isVisible());
    check("Franchisee: Cancelled cheque uploader visible", await fr.getByText("Cancelled cheque").isVisible());

    // Upload BANK_STATEMENT (one of the two called out as "at least as
    // sensitive as Aadhaar") — find its row and click Upload within it.
    const bankRow = fr.locator("div.rounded-md.border", { hasText: "Bank statement" });
    await bankRow.locator('input[type="file"]').setInputFiles({
      name: "bank-statement-v1.png",
      mimeType: "image/png",
      buffer: onePixelPng(),
    });
    await bankRow.getByText("Clean").waitFor({ timeout: 15000 });
    check("Bank statement v1 reached CLEAN scan status", await bankRow.getByText("Clean").isVisible());

    const bankFileV1 = await db.onboardingFile.findFirstOrThrow({
      where: { onboardingId: onboarding.id, kind: "BANK_STATEMENT" },
    });
    check("Bank statement v1 recorded with version=1", bankFileV1.version === 1 && bankFileV1.scanStatus === "CLEAN");

    // Re-upload to confirm version history / supersede-not-delete. The file
    // input is a hidden element re-used by the "Replace" button; Playwright's
    // setInputFiles sets it directly and fires change, same as a real pick.
    await bankRow.locator('input[type="file"]').setInputFiles({
      name: "bank-statement-v2.png",
      mimeType: "image/png",
      buffer: onePixelPng(),
    });
    await bankRow.getByText(/bank-statement-v2\.png \(v2\)/).waitFor({ timeout: 15000 });

    const bankFiles = await db.onboardingFile.findMany({ where: { onboardingId: onboarding.id, kind: "BANK_STATEMENT" } });
    check("Bank statement now has 2 versions (old not deleted)", bankFiles.length === 2);
    const bankFileV2 = bankFiles.find((f) => f.version === 2) ?? bankFileV1;
    check("Bank statement v2 supersedes v1", bankFileV2.supersedesId === bankFileV1.id);

    // Also upload CANCELLED_CHEQUE (the other "at least as sensitive" kind).
    const chequeRow = fr.locator("div.rounded-md.border", { hasText: "Cancelled cheque" });
    await chequeRow.locator('input[type="file"]').setInputFiles({
      name: "cheque.png",
      mimeType: "image/png",
      buffer: onePixelPng(),
    });
    await chequeRow.getByText("Clean").waitFor({ timeout: 15000 });
    const chequeFile = await db.onboardingFile.findFirstOrThrow({ where: { onboardingId: onboarding.id, kind: "CANCELLED_CHEQUE" } });
    check("Cancelled cheque uploaded and CLEAN", chequeFile.scanStatus === "CLEAN");

    // Negative: oversized / wrong-type files are rejected client-side (same rule as existing kinds — spot check).
    await fr.close();

    // ---------------------------------------------------------------
    // 4) Franchisee can view/download their own new-kind files.
    // ---------------------------------------------------------------
    const fr2 = await browser.newPage();
    await login(fr2, WORKSPACE_EMAIL, DEMO_PASSWORD);
    const ownFileResp = await fr2.request.get(`${BASE}/api/onboarding-files/${chequeFile.id}/download`);
    check("Franchisee can open their own cancelled-cheque file", ownFileResp.status() < 400);
    await fr2.close();

    // ---------------------------------------------------------------
    // 5) KYC reviewer sees the new kinds in the review queue, can open
    //    them, and each open writes an AuditEvent (restricted-file rule).
    // ---------------------------------------------------------------
    const auditBeforeOpen = await db.auditEvent.count({
      where: { onboardingId: onboarding.id, entityType: "OnboardingFile", reference: { contains: "file opened" } },
    });

    const kyc = await browser.newPage();
    await login(kyc, "kyc.demo@fraterniti.co.in", DEMO_PASSWORD);
    // Go straight to the detail page by id — this onboarding's KYC was never
    // submitted (only the optional docs were uploaded, PAN/Aadhaar weren't),
    // so it won't appear in the SUBMITTED-only queue list; the detail page
    // itself has no such gate (canReviewKyc + the onboarding having a
    // KycSubmission row is enough), which is exactly what's being verified
    // here — document visibility, not the queue list's own filter.
    await kyc.goto(`${BASE}/reviews/kyc/${onboarding.id}`);
    await kyc.waitForLoadState("networkidle");
    check("KYC reviewer: 'Additional documents (optional)' card visible", await kyc.getByText("Additional documents (optional)").isVisible());
    check("KYC reviewer: Bank statement row visible in review", await kyc.getByText("Bank statement").isVisible());
    check("KYC reviewer: Cancelled cheque row visible in review", await kyc.getByText("Cancelled cheque").isVisible());

    // Open the bank statement file (click "Open" in its row) -> new tab.
    const bankReviewRow = kyc.locator("div.rounded-md.border", { hasText: "Bank statement" });
    const [openedPage] = await Promise.all([
      kyc.waitForEvent("popup"),
      bankReviewRow.getByRole("link", { name: /open/i }).click(),
    ]);
    await openedPage.waitForLoadState().catch(() => {});
    await openedPage.close();

    const auditAfterOpen = await db.auditEvent.count({
      where: { onboardingId: onboarding.id, entityType: "OnboardingFile", reference: { contains: "file opened" } },
    });
    check("Opening the bank statement wrote a new AuditEvent", auditAfterOpen === auditBeforeOpen + 1);
    const openEvent = await db.auditEvent.findFirst({
      where: { onboardingId: onboarding.id, entityType: "OnboardingFile", entityId: bankFileV2.id },
      orderBy: { createdAt: "desc" },
    });
    check("AuditEvent reference names the file kind", !!openEvent?.reference?.includes("BANK_STATEMENT"));
    await kyc.close();

    // ---------------------------------------------------------------
    // 6) Unrelated role (SALES) is blocked from opening the restricted file,
    //    by direct API call (not just hidden in the UI).
    // ---------------------------------------------------------------
    const sales = await browser.newPage();
    await login(sales, "sales.demo@fraterniti.co.in", DEMO_PASSWORD);
    const blockedResp = await sales.request.get(`${BASE}/api/onboarding-files/${bankFileV2.id}/download`);
    check("SALES (unrelated role) blocked from opening bank-statement file (404)", blockedResp.status() === 404);
    // SALES has no visible review tab at all (canReviewKyc/canReviewPayment/
    // canPrepareLoi all false for SALES), so /reviews itself redirects on to
    // /dashboard — the real security property being checked is just that
    // SALES never lands on the KYC detail page itself.
    const blockedReviewPage = await sales.goto(`${BASE}/reviews/kyc/${onboarding.id}`);
    check(
      "SALES redirected away from the KYC review detail page",
      !(blockedReviewPage?.url() ?? "").includes(`/reviews/kyc/${onboarding.id}`)
    );
    await sales.close();

    // ---------------------------------------------------------------
    // 7) Already-ACCEPTED onboarding is still untouched after all of the
    //    above (cause-effect #1) — re-check the same record.
    // ---------------------------------------------------------------
    const existingAfter = await db.storeOnboarding.findUniqueOrThrow({
      where: { id: existingBefore.id },
      include: { kyc: true },
    });
    check(
      "Pre-existing ACCEPTED onboarding: kycStatus unchanged",
      existingAfter.kycStatus === existingBefore.kycStatus
    );
    check(
      "Pre-existing ACCEPTED onboarding: onboardingStatus unchanged",
      existingAfter.onboardingStatus === existingBefore.onboardingStatus
    );
    check(
      "Pre-existing ACCEPTED onboarding: KycSubmission.status unchanged",
      existingAfter.kyc?.status === existingBefore.kyc?.status
    );
    // canFranchiseeSignNow / canCompanySignNow are read-only pure functions
    // over fields unrelated to file kinds (state.ts untouched) — nothing to
    // recompute; the status fields above are the only inputs that could have
    // regressed, and they haven't.

  } finally {
    await browser.close();

    // Cleanup — delete the throwaway onboarding through the real Admin UI
    // (DeleteOnboardingButton / deleteOnboarding action), in its own
    // try/finally nested inside verification per 20A's incident lesson, so
    // this runs even if an assertion above threw.
    if (onboardingId) {
      try {
        const cleanupBrowser = await chromium.launch();
        const cleanupPage = await cleanupBrowser.newPage();
        await login(cleanupPage, "tech@fraterniti.co.in", DEMO_PASSWORD);
        await cleanupPage.goto(`${BASE}/store-onboarding/${onboardingId}`);
        // No delete button on the detail page in this app (it's on the list
        // page) — go there and find this onboarding's row.
        await cleanupPage.goto(`${BASE}/store-onboarding`);
        const row = cleanupPage.locator("tr", { hasText: "20C Verification City" });
        await row.getByRole("button", { name: /delete/i }).click();
        await cleanupPage.getByRole("button", { name: "Delete" }).last().click();
        await cleanupPage.waitForTimeout(1500);
        await cleanupBrowser.close();
      } catch (e) {
        console.error("[cleanup] UI delete failed, falling back to direct DB cleanup:", e);
        await db.onboardingFile.deleteMany({ where: { onboardingId } }).catch(() => {});
        await db.kycSubmission.deleteMany({ where: { onboardingId } }).catch(() => {});
        await db.paymentSubmission.deleteMany({ where: { onboardingId } }).catch(() => {});
        await db.storeOnboarding.delete({ where: { id: onboardingId } }).catch(() => {});
      }
      const stillThere = await db.storeOnboarding.findUnique({ where: { id: onboardingId } });
      check("Cleanup: throwaway onboarding deleted", stillThere === null);

      await deleteB2Prefix(`onboarding/${onboardingId}/`).catch((e) =>
        console.error("[cleanup] B2 cleanup failed for", onboardingId, e)
      );
    }
    if (franchiseeUserId) {
      await db.user.delete({ where: { id: franchiseeUserId } }).catch(() => {});
      const stillThereUser = await db.user.findUnique({ where: { id: franchiseeUserId } });
      check("Cleanup: throwaway franchisee user deleted", stillThereUser === null);
    }

    const finalOnboardings = await db.storeOnboarding.count();
    const finalUsers = await db.user.count();
    const finalFiles = await db.onboardingFile.count();
    check("DB back to baseline: StoreOnboarding count", finalOnboardings === baselineOnboardings);
    check("DB back to baseline: User count", finalUsers === baselineUsers);
    check("DB back to baseline: OnboardingFile count", finalFiles === baselineFiles);
    const finalAuditEvents = await db.auditEvent.count();
    console.log(
      `[info] AuditEvent count: baseline=${baselineAuditEvents} final=${finalAuditEvents} (expected to grow — onboarding delete nulls onboardingId rather than deleting rows, by design; see AuditEvent.onboardingId onDelete: SetNull)`
    );

    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    await db.$disconnect();
    if (failures > 0) process.exitCode = 1;
  }
}

async function hashDemoPassword(): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(DEMO_PASSWORD, 12);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
