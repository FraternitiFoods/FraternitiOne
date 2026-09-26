"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canPrepareLoi, canManageOnboardingAdmin } from "@/lib/permissions";
import { transitionLoiVersion, transitionReview, transitionEsignAttempt } from "@/lib/onboarding/state";
import { recomputeOnboardingStatus } from "@/lib/onboarding/recompute";
import { notifyIfNewlyReadyForSignature } from "@/lib/onboarding/notify";
import { getActiveLoiTemplate, nextVersionNo, amountToWords } from "@/lib/onboarding/loi-template";
import { generateLoiPdf, validateLoiValues, type LoiValues } from "@/lib/onboarding/loi-pdf";
import { uploadDocument } from "@/lib/storage";
import { formatOnboardingCode } from "@/lib/onboarding/ids";

export type LoiActionState = { error?: string } | undefined;

/**
 * Generates a new DRAFT LoiVersion. If the current version is already past
 * DRAFT (RELEASED or later), it's voided first — new commercial terms after
 * signing started means a fresh version, never an in-place edit (P1-11).
 * Any non-terminal e-sign attempts on the voided version are cancelled at
 * the DB layer here; step 6 wires the actual provider voidEnvelope() call
 * into this same spot once the e-sign adapter exists.
 */
export async function generateLoiVersion(
  onboardingId: string,
  _prevState: LoiActionState,
  formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user)) {
    return { error: "You don't have permission to prepare the LOI." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { currentLoiVersion: { include: { attempts: true } } },
  });
  if (!onboarding) return { error: "Onboarding not found." };

  const territory = String(formData.get("territory") || "").trim();
  const commercialTerms = String(formData.get("commercialTerms") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  const feeAmountRupeesRaw = formData.get("feeAmountRupees");
  const feeAmountRupees = feeAmountRupeesRaw ? Number(feeAmountRupeesRaw) : onboarding.expectedAmount / 100;

  if (!territory || !commercialTerms) {
    return { error: "Territory and commercial terms are required." };
  }
  if (!feeAmountRupees || feeAmountRupees <= 0) {
    return { error: "Fee amount must be greater than zero." };
  }

  const template = await getActiveLoiTemplate();

  const values: LoiValues = {
    brand: onboarding.brand,
    storeLocation: onboarding.proposedLocation,
    applicantLegalName: onboarding.legalApplicantName,
    entityType: onboarding.entityType,
    companyName: onboarding.entityType === "COMPANY" ? ` (${companyName || "company TBD"})` : "",
    feeAmount: `₹${feeAmountRupees.toLocaleString("en-IN")}`,
    feeInWords: amountToWords(feeAmountRupees),
    territory,
    commercialTerms,
    issueDate: new Date().toLocaleDateString("en-IN"),
    versionNo: nextVersionNo(onboarding.currentLoiVersion?.versionNo ?? null),
  };

  const validationError = validateLoiValues(values);
  if (validationError) return { error: validationError };

  const { pdfBytes, sha256 } = await generateLoiPdf({
    templateBody: template.body,
    isPlaceholder: template.isPlaceholder,
    values,
  });

  const key = `onboarding/${onboardingId}/loi/${values.versionNo}/loi.pdf`;
  await uploadDocument({ key, body: Buffer.from(pdfBytes), contentType: "application/pdf" });

  await db.$transaction(async (tx) => {
    const current = onboarding.currentLoiVersion;
    if (current && current.status !== "DRAFT") {
      await tx.loiVersion.update({
        where: { id: current.id },
        data: { status: transitionLoiVersion(current.status, "VOID") },
      });
      await writeAuditEvent(tx, {
        actor: user,
        onboardingId,
        entityType: "LoiVersion",
        entityId: current.id,
        action: "UPDATE",
        oldValue: { status: current.status },
        newValue: { status: "VOID" },
        reference: `Superseded by v${values.versionNo}`,
      });
      for (const attempt of current.attempts) {
        if (attempt.status === "SENT" || attempt.status === "IN_PROGRESS") {
          await tx.esignAttempt.update({
            where: { id: attempt.id },
            data: { status: transitionEsignAttempt(attempt.status, "CANCEL") },
          });
        }
      }
    }

    const created = await tx.loiVersion.create({
      data: {
        onboardingId,
        versionNo: values.versionNo,
        templateId: template.id,
        templateVersion: template.version,
        values,
        pdfB2Key: key,
        pdfSha256: sha256,
        status: "DRAFT",
      },
    });

    await tx.storeOnboarding.update({
      where: { id: onboardingId },
      data: { currentLoiVersionId: created.id },
    });

    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "LoiVersion",
      entityId: created.id,
      action: "CREATE",
      newValue: { versionNo: created.versionNo, pdfSha256: created.pdfSha256 },
      reference: `Generated by ${user.name}${template.isPlaceholder ? " (placeholder template)" : ""}`,
    });

    await recomputeOnboardingStatus(tx, onboardingId);
  });

  revalidatePath(`/store-onboarding/${onboardingId}`);
  return undefined;
}

/** DRAFT -> RELEASED. Blocked on a placeholder template unless ALLOW_PLACEHOLDER_LOI=true (never in production without it). */
export async function releaseLoiVersion(
  onboardingId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: LoiActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user)) {
    return { error: "You don't have permission to release the LOI." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { franchisee: true, currentLoiVersion: { include: { template: true } } },
  });
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "Generate an LOI version first." };
  if (version.status !== "DRAFT") return { error: "This version isn't in draft." };

  const allowPlaceholder = process.env.ALLOW_PLACEHOLDER_LOI === "true";
  if (version.template.isPlaceholder && !allowPlaceholder) {
    return {
      error: "This LOI uses the placeholder template — set ALLOW_PLACEHOLDER_LOI=true to release it (dev/test only).",
    };
  }
  if (version.template.isPlaceholder && process.env.NODE_ENV === "production") {
    return { error: "Placeholder LOI templates can never be released in production." };
  }

  const recompute = await db.$transaction(async (tx) => {
    await tx.loiVersion.update({
      where: { id: version.id },
      data: {
        status: transitionLoiVersion(version.status, "RELEASE"),
        releasedById: user.id,
        releasedAt: new Date(),
      },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "LoiVersion",
      entityId: version.id,
      action: "UPDATE",
      oldValue: { status: "DRAFT" },
      newValue: { status: "RELEASED" },
      reference: `Released by ${user.name} (${formatOnboardingCode(onboarding.seq)})`,
    });
    return recomputeOnboardingStatus(tx, onboardingId);
  });

  await notifyIfNewlyReadyForSignature(recompute, onboarding);

  revalidatePath(`/store-onboarding/${onboardingId}`);
  return undefined;
}

/**
 * Fee-change rule (P1-12): raising expectedAmount above the last verified
 * amount drops payment back to SUBMITTED (Accounts must re-confirm) and
 * e-sign disables again via the derived status/gate functions — no separate
 * "lock e-sign" flag needed since canFranchiseeSignNow already re-checks
 * paymentStatus === ACCEPTED on every call.
 */
export async function updateExpectedAmount(
  onboardingId: string,
  _prevState: LoiActionState,
  formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user) && !canManageOnboardingAdmin(user)) {
    return { error: "You don't have permission to change the fee amount." };
  }

  const newAmountRupees = Number(formData.get("expectedAmountRupees"));
  if (!newAmountRupees || newAmountRupees <= 0) {
    return { error: "Enter a valid fee amount." };
  }
  const newAmount = Math.round(newAmountRupees * 100);

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!onboarding) return { error: "Onboarding not found." };
  const latestPayment = onboarding.payments[0];

  await db.$transaction(async (tx) => {
    await tx.storeOnboarding.update({ where: { id: onboardingId }, data: { expectedAmount: newAmount } });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "StoreOnboarding",
      entityId: onboardingId,
      action: "UPDATE",
      oldValue: { expectedAmount: onboarding.expectedAmount },
      newValue: { expectedAmount: newAmount },
      reference: `Fee amount updated by ${user.name}`,
    });

    if (
      latestPayment &&
      latestPayment.status === "ACCEPTED" &&
      newAmount > (latestPayment.verifiedAmount ?? 0)
    ) {
      await tx.paymentSubmission.update({
        where: { id: latestPayment.id },
        data: { status: transitionReview(latestPayment.status, "REOPEN") },
      });
      await writeAuditEvent(tx, {
        actor: user,
        onboardingId,
        entityType: "PaymentSubmission",
        entityId: latestPayment.id,
        action: "UPDATE",
        oldValue: { status: "ACCEPTED" },
        newValue: { status: "SUBMITTED" },
        reference: "Re-opened for Accounts re-confirmation — fee raised above previously verified amount",
      });
    }

    await recomputeOnboardingStatus(tx, onboardingId);
  });

  revalidatePath(`/store-onboarding/${onboardingId}`);
  return undefined;
}
