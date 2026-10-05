"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canPrepareLoi, canManageOnboardingAdmin } from "@/lib/permissions";
import { transitionLoiVersion, transitionReview, transitionEsignAttempt } from "@/lib/onboarding/state";
import { recomputeOnboardingStatus } from "@/lib/onboarding/recompute";
import { notifyIfNewlyReadyForSignature } from "@/lib/onboarding/notify";
import { getActiveLoiTemplate, nextVersionNo, amountToWords, maskAadhaar } from "@/lib/onboarding/loi-template";
import {
  generateLoiPdf,
  validateLoiValues,
  getTemplateSectionDefaults,
  LOI_SECTION_LABELS,
  type LoiValues,
} from "@/lib/onboarding/loi-pdf";
import { uploadDocument } from "@/lib/storage";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { getEsignProvider, currentProviderName } from "@/lib/esign";

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
    include: { currentLoiVersion: { include: { attempts: true } }, kyc: true },
  });
  if (!onboarding) return { error: "Onboarding not found." };

  const territory = String(formData.get("territory") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  const feeAmountRupeesRaw = formData.get("feeAmountRupees");
  const feeAmountRupees = feeAmountRupeesRaw ? Number(feeAmountRupeesRaw) : onboarding.expectedAmount / 100;

  if (!territory) {
    return { error: "Territory is required." };
  }
  if (!feeAmountRupees || feeAmountRupees <= 0) {
    return { error: "Fee amount must be greater than zero." };
  }

  const template = await getActiveLoiTemplate();

  const name =
    onboarding.entityType === "COMPANY" ? companyName || "company TBD" : onboarding.legalApplicantName;

  const values: LoiValues = {
    name,
    aadhaarMasked: maskAadhaar(onboarding.kyc?.aadhaarLast4 ?? null),
    feeAmount: feeAmountRupees.toLocaleString("en-IN"),
    feeInWords: amountToWords(feeAmountRupees),
    territory,
    issueDate: new Date().toLocaleDateString("en-IN"),
    versionNo: nextVersionNo(onboarding.currentLoiVersion?.versionNo ?? null),
  };

  const validationError = validateLoiValues(values);
  if (validationError) return { error: validationError };

  const { pdfBytes, sha256 } = await generateLoiPdf({
    templateBody: template.body,
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

/**
 * plan.md section 19 L3: edits a DRAFT LoiVersion in place — the one point a
 * template variable or a §SECTION's wording can be customized per-version.
 * Regenerates the PDF over the same pdfB2Key (a DRAFT's bytes were never
 * sent anywhere, so overwriting is a plain replace) and re-hashes. Only ever
 * runs against status === DRAFT; RELEASED+ versions are immutable (P1-11) —
 * "edit after release" is newLoiVersionFromCurrent below, not this.
 */
export async function updateLoiDraft(
  onboardingId: string,
  _prevState: LoiActionState,
  formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user)) {
    return { error: "You don't have permission to edit the LOI." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { currentLoiVersion: { include: { template: true } } },
  });
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "Generate an LOI version first." };
  if (version.status !== "DRAFT") return { error: "This version isn't in draft." };

  const oldValues = version.values as unknown as LoiValues;
  const territory = String(formData.get("territory") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  const feeAmountRupeesRaw = formData.get("feeAmountRupees");
  const feeAmountRupees = feeAmountRupeesRaw
    ? Number(feeAmountRupeesRaw)
    : Number(String(oldValues.feeAmount).replace(/,/g, ""));
  const issueDate = String(formData.get("issueDate") || "").trim() || oldValues.issueDate;

  if (!territory) return { error: "Territory is required." };
  if (!feeAmountRupees || feeAmountRupees <= 0) return { error: "Fee amount must be greater than zero." };

  const name = onboarding.entityType === "COMPANY" ? companyName || oldValues.name : oldValues.name;

  const newValues: LoiValues = {
    ...oldValues,
    name,
    feeAmount: feeAmountRupees.toLocaleString("en-IN"),
    feeInWords: amountToWords(feeAmountRupees),
    territory,
    issueDate,
  };

  const validationError = validateLoiValues(newValues);
  if (validationError) return { error: validationError };

  // Only store a section's override when it actually differs from the
  // template's own rendered text — matches bodyOverrides's documented
  // semantics (key absent = "use the template") instead of drifting into a
  // full copy of every section on every save.
  const templateDefaults = getTemplateSectionDefaults(version.template.body, newValues);
  const oldOverrides = (version.bodyOverrides as Record<string, string> | null) ?? {};
  const newOverrides: Record<string, string> = {};
  for (const { key } of LOI_SECTION_LABELS) {
    const submitted = formData.get(`override_${key}`);
    if (submitted === null) continue;
    const text = String(submitted);
    if (text.trim() !== (templateDefaults[key] ?? "").trim()) {
      newOverrides[key] = text;
    }
  }

  const { pdfBytes, sha256 } = await generateLoiPdf({
    templateBody: version.template.body,
    values: newValues,
    sectionOverrides: newOverrides,
  });
  await uploadDocument({ key: version.pdfB2Key, body: Buffer.from(pdfBytes), contentType: "application/pdf" });

  const changedFields = (Object.keys(newValues) as (keyof LoiValues)[]).filter(
    (k) => String(oldValues[k] ?? "") !== String(newValues[k] ?? "")
  );
  const changedSections = LOI_SECTION_LABELS.map((s) => s.key).filter(
    (key) => (oldOverrides[key] ?? "") !== (newOverrides[key] ?? "")
  );

  await db.$transaction(async (tx) => {
    await tx.loiVersion.update({
      where: { id: version.id },
      data: { values: newValues, bodyOverrides: newOverrides, pdfSha256: sha256 },
    });
    // Audit which fields/sections changed, not the full text (plan.md L3).
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "LoiVersion",
      entityId: version.id,
      action: "UPDATE",
      newValue: { changedFields, changedSections },
      reference: `Draft edited by ${user.name}`,
    });
  });

  revalidatePath(`/store-onboarding/${onboardingId}`);
  return undefined;
}

/**
 * plan.md section 19 L3: clears one section's override, falling back to the
 * template's own text for that section ("reset to template" per-section).
 */
export async function resetLoiSection(
  onboardingId: string,
  _prevState: LoiActionState,
  formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user)) {
    return { error: "You don't have permission to edit the LOI." };
  }

  const sectionKey = String(formData.get("sectionKey") || "");
  if (!LOI_SECTION_LABELS.some((s) => s.key === sectionKey)) {
    return { error: "Unknown section." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { currentLoiVersion: { include: { template: true } } },
  });
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "Generate an LOI version first." };
  if (version.status !== "DRAFT") return { error: "This version isn't in draft." };

  const oldOverrides = (version.bodyOverrides as Record<string, string> | null) ?? {};
  if (!(sectionKey in oldOverrides)) return undefined;

  const newOverrides = { ...oldOverrides };
  delete newOverrides[sectionKey];

  const { pdfBytes, sha256 } = await generateLoiPdf({
    templateBody: version.template.body,
    values: version.values as unknown as LoiValues,
    sectionOverrides: newOverrides,
  });
  await uploadDocument({ key: version.pdfB2Key, body: Buffer.from(pdfBytes), contentType: "application/pdf" });

  await db.$transaction(async (tx) => {
    await tx.loiVersion.update({
      where: { id: version.id },
      data: { bodyOverrides: newOverrides, pdfSha256: sha256 },
    });
    await writeAuditEvent(tx, {
      actor: user,
      onboardingId,
      entityType: "LoiVersion",
      entityId: version.id,
      action: "UPDATE",
      newValue: { changedSections: [sectionKey], reset: true },
      reference: `Section "${sectionKey}" reset to template by ${user.name}`,
    });
  });

  revalidatePath(`/store-onboarding/${onboardingId}`);
  return undefined;
}

/**
 * plan.md section 19 L3: "New version from this" — the only way to keep
 * editing wording/values once a version is RELEASED+ (P1-11: a released
 * version's own bytes are immutable). Copies values and bodyOverrides
 * forward verbatim into a fresh DRAFT at versionNo +0.1, voiding the current
 * version the same way generateLoiVersion does when it supersedes a
 * non-DRAFT version.
 */
/**
 * plan.md section 19 L5, edge case 1: "terms change after signing started →
 * new LOI version → old Leegality document: download what it holds into B2,
 * then delete it." Runs BEFORE any DB transaction — a provider network call
 * must never happen inside an interactive Postgres transaction (same
 * discipline as webhook-processor.ts). Two attempts (FRANCHISEE, COMPANY)
 * can share one documentId under decision 4, so envelopes are deduped before
 * voiding each once. Best-effort backup (a Draft/Sent document may have
 * nothing signed yet to fetch) but the void call itself is not swallowed —
 * if Leegality can't be reached, the new version isn't created, so a stale,
 * still-open signing link for superseded terms never lingers (P1-11).
 */
async function backupAndVoidLeegalityEnvelopes(
  onboardingId: string,
  versionNo: string,
  attempts: { provider: string; status: string; providerEnvelopeId: string | null }[]
): Promise<{ envelopeId: string; backedUp: boolean }[]> {
  const envelopeIds = new Set(
    attempts
      .filter((a) => a.provider === "leegality" && (a.status === "SENT" || a.status === "IN_PROGRESS") && a.providerEnvelopeId)
      .map((a) => a.providerEnvelopeId as string)
  );
  if (envelopeIds.size === 0) return [];

  const provider = getEsignProvider();
  const results: { envelopeId: string; backedUp: boolean }[] = [];

  for (const envelopeId of envelopeIds) {
    let backedUp = false;
    try {
      const [document, certificate] = await Promise.all([
        provider.fetchSignedPdf(envelopeId),
        provider.fetchCertificate(envelopeId),
      ]);
      await uploadDocument({
        key: `onboarding/${onboardingId}/loi/${versionNo}/superseded-${envelopeId}-document.pdf`,
        body: document,
        contentType: "application/pdf",
      });
      await uploadDocument({
        key: `onboarding/${onboardingId}/loi/${versionNo}/superseded-${envelopeId}-certificate.pdf`,
        body: certificate,
        contentType: "application/pdf",
      });
      backedUp = true;
    } catch (err) {
      // Nothing to back up yet (e.g. still Draft/Sent, no signature at all) —
      // not fatal. The void call below is what must still succeed.
      console.error(`No backup available for superseded Leegality document ${envelopeId}:`, err);
    }
    await provider.voidEnvelope(envelopeId);
    results.push({ envelopeId, backedUp });
  }

  return results;
}

export async function newLoiVersionFromCurrent(
  onboardingId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: LoiActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<LoiActionState> {
  const user = await requireUser();
  if (!canPrepareLoi(user)) {
    return { error: "You don't have permission to prepare the LOI." };
  }

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { currentLoiVersion: { include: { attempts: true, template: true } } },
  });
  const current = onboarding?.currentLoiVersion;
  if (!onboarding || !current) return { error: "Generate an LOI version first." };
  if (current.status === "DRAFT") return { error: "This version is already a draft — edit it directly." };

  const values = current.values as unknown as LoiValues;
  const overrides = (current.bodyOverrides as Record<string, string> | null) ?? {};
  const versionNo = nextVersionNo(current.versionNo);
  const newValues: LoiValues = { ...values, versionNo };

  // Edge case 1, before anything else: if terms are changing while a real
  // Leegality document is still open on the OLD version, back it up and
  // void it first. If Leegality can't be reached, stop here rather than
  // create a new version while a stale signing link for superseded terms
  // stays open.
  let voidResults: { envelopeId: string; backedUp: boolean }[] = [];
  if (currentProviderName() === "leegality") {
    try {
      voidResults = await backupAndVoidLeegalityEnvelopes(onboardingId, current.versionNo, current.attempts);
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? `Could not close out the old e-sign document before creating a new version: ${err.message}`
            : "Could not close out the old e-sign document before creating a new version.",
      };
    }
  }

  const { pdfBytes, sha256 } = await generateLoiPdf({
    templateBody: current.template.body,
    values: newValues,
    sectionOverrides: overrides,
  });

  const key = `onboarding/${onboardingId}/loi/${versionNo}/loi.pdf`;
  await uploadDocument({ key, body: Buffer.from(pdfBytes), contentType: "application/pdf" });

  await db.$transaction(async (tx) => {
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
      newValue: { status: "VOID", voidedLeegalityEnvelopes: voidResults },
      reference: `Superseded by v${versionNo} (new version from this)`,
    });
    for (const attempt of current.attempts) {
      if (attempt.status === "SENT" || attempt.status === "IN_PROGRESS") {
        await tx.esignAttempt.update({
          where: { id: attempt.id },
          data: { status: transitionEsignAttempt(attempt.status, "CANCEL") },
        });
      }
    }

    const created = await tx.loiVersion.create({
      data: {
        onboardingId,
        versionNo,
        templateId: current.templateId,
        templateVersion: current.templateVersion,
        values: newValues,
        bodyOverrides: overrides,
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
      reference: `New version from v${current.versionNo} by ${user.name}`,
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
