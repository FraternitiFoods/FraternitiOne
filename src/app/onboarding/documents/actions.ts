"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { getSupervisorUploadUrl, buildOnboardingFileKey, getObjectBuffer } from "@/lib/storage";
import { scanFile } from "@/lib/onboarding/malware-scan";
import { encryptPan } from "@/lib/onboarding/pan-encryption";
import { transitionReview } from "@/lib/onboarding/state";
import { requiredKycFileKinds } from "@/lib/onboarding/kyc-requirements";
import { recomputeOnboardingStatus } from "@/lib/onboarding/recompute";
import type { CurrentUser } from "@/lib/session";
import { createHash } from "node:crypto";
import type { OnboardingFileKind, Prisma } from "@prisma/client";

// P1-04: KYC files (and receipts) capped at 10MB.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

async function requireOwnOnboarding(): Promise<{ user: CurrentUser; onboardingId: string }> {
  const user = await requireUser();
  if (user.role !== "FRANCHISEE") throw new Error("Not authorized.");
  const onboarding = await db.storeOnboarding.findUnique({
    where: { franchiseeUserId: user.id },
    select: { id: true },
  });
  if (!onboarding) throw new Error("Not authorized.");
  return { user, onboardingId: onboarding.id };
}

export type PresignResult = { error: string } | { uploadUrl: string; key: string };

/** Step 1: validate + issue a presigned B2 PUT URL for a KYC file or payment receipt. */
export async function getPresignedOnboardingUpload(input: {
  kind: OnboardingFileKind;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<PresignResult> {
  const { onboardingId } = await requireOwnOnboarding();

  if (input.fileSize > MAX_UPLOAD_BYTES) {
    return { error: "File is too large (max 10MB)." };
  }
  if (!ALLOWED_MIME_TYPES.includes(input.contentType)) {
    return { error: "Only PDF, JPG or PNG files are accepted." };
  }

  const key = buildOnboardingFileKey({ onboardingId, kind: input.kind, fileName: input.fileName });
  const uploadUrl = await getSupervisorUploadUrl({ key, contentType: input.contentType });
  return { uploadUrl, key };
}

async function recordOnboardingFile(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  onboardingId: string,
  input: { kind: OnboardingFileKind; key: string; fileName: string; fileSize: number; contentType: string }
) {
  const previous = await tx.onboardingFile.findFirst({
    where: { onboardingId, kind: input.kind, supersededBy: null },
    orderBy: { version: "desc" },
  });

  const buffer = await getObjectBuffer(input.key);
  const scan = await scanFile(buffer, input.contentType);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  // `supersedesId` lives on the NEW row pointing back at the old one — the
  // old row's `supersededBy` is just the reverse of that same relation, so
  // creating this row is the only write needed to complete the version
  // chain (mirrors the Document vault's version-history shape, plan.md
  // section 4/17).
  const file = await tx.onboardingFile.create({
    data: {
      onboardingId,
      kind: input.kind,
      version: (previous?.version ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      b2Key: input.key,
      fileName: input.fileName,
      mimeType: input.contentType,
      sizeBytes: input.fileSize,
      sha256,
      scanStatus: scan.status,
      scanError: scan.error,
      uploadedById: user.id,
    },
  });

  await writeAuditEvent(tx, {
    actor: user,
    onboardingId,
    entityType: "OnboardingFile",
    entityId: file.id,
    action: "CREATE",
    newValue: { kind: file.kind, fileName: file.fileName, version: file.version, scanStatus: file.scanStatus },
    reference: `Uploaded by franchisee (version ${file.version})`,
  });

  return file;
}

export type FinalizeResult = { error: string } | { success: true; scanStatus: string };

/** Step 2 for KYC files (PAN/AADHAAR/COMPANY_DOC/SIGNATORY_PROOF). */
export async function finalizeKycFileUpload(input: {
  kind: OnboardingFileKind;
  key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<FinalizeResult> {
  const { user, onboardingId } = await requireOwnOnboarding();

  if (input.kind === "PAYMENT_RECEIPT") {
    return { error: "Use the payment form to upload a receipt." };
  }

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  if (onboarding.kycStatus !== "MISSING" && onboarding.kycStatus !== "CHANGES_REQUESTED") {
    return { error: "KYC is already submitted or accepted — files can't be changed right now." };
  }

  const file = await db.$transaction(async (tx) => {
    return recordOnboardingFile(tx, user, onboardingId, input);
  });

  revalidatePath("/onboarding/documents");
  return { success: true, scanStatus: file.scanStatus };
}

const KycDetailsSchema = {
  panNumber: (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim().toUpperCase() : ""),
};

/** Saves the KYC text fields (never changes status — see submitKycForReview). */
export async function saveKycDetails(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const { user, onboardingId } = await requireOwnOnboarding();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  if (onboarding.kycStatus !== "MISSING" && onboarding.kycStatus !== "CHANGES_REQUESTED") {
    return { error: "KYC is already submitted or accepted — details can't be changed right now." };
  }

  const panNumber = KycDetailsSchema.panNumber(formData.get("panNumber"));
  const panName = String(formData.get("panName") || "").trim();
  const aadhaarHolderName = String(formData.get("aadhaarHolderName") || "").trim();
  const aadhaarLast4 = String(formData.get("aadhaarLast4") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  const companyPan = String(formData.get("companyPan") || "").trim().toUpperCase();
  const authorisedSignatoryName = String(formData.get("authorisedSignatoryName") || "").trim();

  if (aadhaarLast4 && !/^\d{4}$/.test(aadhaarLast4)) {
    return { error: "Aadhaar last 4 digits must be exactly 4 digits." };
  }

  await db.$transaction(async (tx) => {
    await tx.kycSubmission.update({
      where: { onboardingId },
      data: {
        panNumberEncrypted: panNumber ? encryptPan(panNumber) : undefined,
        panName: panName || undefined,
        aadhaarHolderName: aadhaarHolderName || undefined,
        aadhaarLast4: aadhaarLast4 || undefined,
        companyName: companyName || undefined,
        companyPan: companyPan || undefined,
        authorisedSignatoryName: authorisedSignatoryName || undefined,
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "KycSubmission",
      entityId: onboardingId,
      action: "UPDATE",
      reference: "Franchisee saved KYC details",
    });
  });

  revalidatePath("/onboarding/documents");
  return { success: true };
}

export type SubmitResult = { error?: string; success?: boolean };

/** Explicit "Submit for review" — checks every required file + field is present before transitioning. */
export async function submitKycForReview(): Promise<SubmitResult> {
  const { user, onboardingId } = await requireOwnOnboarding();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    include: { kyc: true, files: { where: { supersededBy: null } } },
  });
  if (!onboarding.kyc) return { error: "Fill in your KYC details first." };
  if (onboarding.kycStatus !== "MISSING" && onboarding.kycStatus !== "CHANGES_REQUESTED") {
    return { error: "KYC has already been submitted." };
  }

  const requiredKinds = requiredKycFileKinds(onboarding.entityType);
  const uploadedKinds = new Set(onboarding.files.map((f) => f.kind));
  const missingKinds = requiredKinds.filter((k) => !uploadedKinds.has(k));
  if (missingKinds.length > 0) {
    return { error: `Missing required documents: ${missingKinds.join(", ")}.` };
  }
  const infected = onboarding.files.find(
    (f) => requiredKinds.includes(f.kind) && f.scanStatus === "INFECTED"
  );
  if (infected) {
    return { error: `${infected.kind} failed the malware scan — please re-upload a clean file.` };
  }
  const notClean = onboarding.files.find(
    (f) => requiredKinds.includes(f.kind) && f.scanStatus !== "CLEAN"
  );
  if (notClean) {
    return { error: "One or more files are still being scanned — try again shortly." };
  }

  const kyc = onboarding.kyc;
  if (!kyc.panNumberEncrypted || !kyc.panName) {
    return { error: "PAN number and name are required." };
  }
  if (onboarding.entityType === "INDIVIDUAL" && (!kyc.aadhaarHolderName || !kyc.aadhaarLast4)) {
    return { error: "Aadhaar holder name and last 4 digits are required." };
  }
  if (
    onboarding.entityType === "COMPANY" &&
    (!kyc.companyName || !kyc.companyPan || !kyc.authorisedSignatoryName)
  ) {
    return { error: "Company name, company PAN and authorised signatory are required." };
  }

  const nextStatus = transitionReview(onboarding.kycStatus, "SUBMIT");

  await db.$transaction(async (tx) => {
    await tx.kycSubmission.update({
      where: { onboardingId },
      data: { status: nextStatus, decisionReason: null },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "KycSubmission",
      entityId: onboardingId,
      action: "UPDATE",
      oldValue: { status: onboarding.kycStatus },
      newValue: { status: nextStatus },
      reference: "Franchisee submitted KYC for review",
    });
    await recomputeOnboardingStatus(tx, onboardingId);
  });

  revalidatePath("/onboarding");
  revalidatePath("/onboarding/documents");
  return { success: true };
}

/** Payment: the receipt upload itself creates the review item (P1-05) — no separate submit step. */
export async function submitPaymentReceipt(input: {
  key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  declaredAmountRupees: number;
  paymentDate: string;
  mode: string;
  utr: string;
}): Promise<SubmitResult> {
  const { user, onboardingId } = await requireOwnOnboarding();

  const onboarding = await db.storeOnboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  if (onboarding.paymentStatus !== "MISSING" && onboarding.paymentStatus !== "CHANGES_REQUESTED") {
    return { error: "A payment submission is already under review or accepted." };
  }

  const utr = input.utr.trim();
  const paymentDate = new Date(input.paymentDate);
  if (Number.isNaN(paymentDate.getTime())) {
    return { error: "Invalid payment date." };
  }
  if (!utr) {
    return { error: "UTR / transaction reference is required." };
  }
  const declaredAmount = Math.round(input.declaredAmountRupees * 100);

  await db.$transaction(async (tx) => {
    const file = await recordOnboardingFile(tx, user, onboardingId, {
      kind: "PAYMENT_RECEIPT",
      key: input.key,
      fileName: input.fileName,
      fileSize: input.fileSize,
      contentType: input.contentType,
    });

    const duplicateUtr = await tx.paymentSubmission.findFirst({
      where: { utr: { equals: utr, mode: "insensitive" }, onboardingId: { not: onboardingId } },
    });
    const flags: string[] = [];
    if (duplicateUtr) flags.push("DUPLICATE_UTR");
    if (declaredAmount !== onboarding.expectedAmount) flags.push("AMOUNT_MISMATCH");

    const payment = await tx.paymentSubmission.create({
      data: {
        onboardingId,
        declaredAmount,
        paymentDate,
        mode: input.mode,
        utr,
        receiptFileId: file.id,
        status: "SUBMITTED",
        flags,
        uploadedById: user.id,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "PaymentSubmission",
      entityId: payment.id,
      action: "CREATE",
      newValue: { declaredAmount, utr, mode: input.mode, flags },
      reference: "Franchisee submitted payment receipt",
    });

    await recomputeOnboardingStatus(tx, onboardingId);
  });

  revalidatePath("/onboarding");
  revalidatePath("/onboarding/documents");
  return { success: true };
}
