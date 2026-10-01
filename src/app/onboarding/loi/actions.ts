"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFranchiseeSignNow, transitionLoiVersion, transitionEsignAttempt } from "@/lib/onboarding/state";
import { getEsignProvider, currentProviderName } from "@/lib/esign";
import { processEsignEvent } from "@/lib/esign/webhook-processor";
import { getObjectBuffer } from "@/lib/storage";
import { requestOtp, verifyOtp } from "@/lib/otp/challenge";
import { getRequestMeta } from "@/lib/otp/request-meta";
import { renderConsentText, CONSENT_TEXT_VERSION } from "@/lib/otp/consent";
import { normalizePhoneToE164, maskPhoneE164 } from "@/lib/otp/phone";
import { writeAuditEvent } from "@/lib/audit";
import { sendOnboardingEmail } from "@/lib/onboarding/notify";

export type StartSignResult = { error: string } | { signingUrl: string; autoCompleted?: boolean };

/**
 * P1-07: the button is disabled in the UI, but this server-side re-check
 * with canFranchiseeSignNow is the real gate — no local "I agree" checkbox
 * may substitute for it, and nothing here trusts what the client claims.
 *
 * Two steps around the network call to the provider, deliberately not both
 * inside one DB transaction: (1) create a NOT_STARTED EsignAttempt row so
 * `attemptId` exists before calling createEnvelope (the interface itself
 * takes attemptId), (2) call the provider, then (3) a second, short
 * transaction records the returned envelopeId + SENT status + audit. A
 * provider-call failure between (1) and (3) just leaves one harmless
 * NOT_STARTED row behind, not a stuck lock or an inconsistent gate.
 */
export async function startFranchiseeEsign(onboardingId: string): Promise<StartSignResult> {
  const user = await requireUser();
  if (user.role !== "FRANCHISEE") return { error: "Not authorized." };

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId, franchiseeUserId: user.id },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      currentLoiVersion: {
        include: { attempts: { where: { signerRole: "FRANCHISEE" }, orderBy: { attemptNo: "desc" }, take: 1 } },
      },
    },
  });
  if (!onboarding || !onboarding.currentLoiVersion) return { error: "Not ready to sign." };

  const version = onboarding.currentLoiVersion;
  const latestAttempt = version.attempts[0] ?? null;

  const allowed = canFranchiseeSignNow({
    kycStatus: onboarding.kycStatus,
    paymentStatus: onboarding.paymentStatus,
    verifiedAmount: onboarding.payments[0]?.verifiedAmount ?? null,
    expectedAmount: onboarding.expectedAmount,
    loiVersionStatus: version.status,
    latestFranchiseAttemptStatus: latestAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Signing isn't available right now — check your KYC, payment and LOI status." };

  let provider;
  try {
    provider = getEsignProvider();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "E-sign is not configured." };
  }

  const attempt = await db.esignAttempt.create({
    data: {
      loiVersionId: version.id,
      signerRole: "FRANCHISEE",
      attemptNo: (latestAttempt?.attemptNo ?? 0) + 1,
      provider: process.env.ESIGN_PROVIDER || "mock",
      pdfSha256: version.pdfSha256,
      status: "NOT_STARTED",
      signerUserId: user.id,
    },
  });

  let envelopeId: string;
  let signingUrl: string;
  try {
    const pdfBytes = await getObjectBuffer(version.pdfB2Key);
    const created = await provider.createEnvelope({
      attemptId: attempt.id,
      signer: { name: user.name, email: user.email ?? "", role: "FRANCHISEE" },
      pdf: Buffer.from(pdfBytes),
      pdfSha256: version.pdfSha256,
      authMode: process.env.COMPANY_SIGN_MODE || "AADHAAR_ESIGN",
    });
    envelopeId = created.envelopeId;
    signingUrl = created.signingUrl;
  } catch (err) {
    await db.esignAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
    return { error: err instanceof Error ? err.message : "Failed to start e-sign." };
  }

  await db.$transaction(async (tx) => {
    await tx.esignAttempt.update({
      where: { id: attempt.id },
      data: { providerEnvelopeId: envelopeId, status: transitionEsignAttempt("NOT_STARTED", "SEND"), sentAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        onboardingId,
        actorId: user.id,
        actorEmail: user.email ?? "(no email on file)",
        actorName: user.name,
        actorRole: user.role,
        entityType: "EsignAttempt",
        entityId: attempt.id,
        action: "CREATE",
        newValue: { signerRole: "FRANCHISEE", attemptNo: attempt.attemptNo, envelopeId },
        reference: "Franchisee started Aadhaar e-sign",
        source: "web",
      },
    });

    if (version.status === "RELEASED") {
      await tx.loiVersion.update({
        where: { id: version.id },
        data: { status: transitionLoiVersion(version.status, "SEND_FOR_SIGNING") },
      });
      await tx.auditEvent.create({
        data: {
          onboardingId,
          actorId: user.id,
          actorEmail: user.email ?? "(no email on file)",
          actorName: user.name,
          actorRole: user.role,
          entityType: "LoiVersion",
          entityId: version.id,
          action: "UPDATE",
          oldValue: { status: "RELEASED" },
          newValue: { status: "SENT_FOR_SIGNING" },
          reference: "Sent for signing",
          source: "web",
        },
      });
    }
  });

  // Testing convenience while no real vendor is wired up yet: skip the
  // separate /dev/mock-esign page and immediately fire the same
  // processEsignEvent() a real webhook would trigger, through the exact same
  // code path the Admin manual-reconcile action uses. Still fully watermarked
  // "TEST SIGNATURE — NOT LEGALLY BINDING" downstream; getEsignProvider()
  // above is the only gate on whether mock can even run in production.
  let autoCompleted = false;
  if (currentProviderName() === "mock") {
    await processEsignEvent(
      { eventId: randomUUID(), envelopeId, status: "COMPLETED", documentSha256: version.pdfSha256 },
      true
    );
    autoCompleted = true;
  }

  revalidatePath("/onboarding/loi");
  return { signingUrl, autoCompleted };
}

export type RequestOtpActionResult = { error: string } | { ok: true; phoneMasked: string; expiresAt: string };
export type VerifyOtpActionResult = { error: string; locked?: boolean } | { ok: true };

async function loadFranchiseeSigningContext(onboardingId: string, userId: string) {
  return db.storeOnboarding.findUnique({
    where: { id: onboardingId, franchiseeUserId: userId },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      currentLoiVersion: {
        include: { attempts: { where: { signerRole: "FRANCHISEE" }, orderBy: { attemptNo: "desc" }, take: 1 } },
      },
    },
  });
}

/**
 * plan.md section 19 "What gets built" #4/#8 — the OTP equivalent of
 * startFranchiseeEsign above, used when SIGNING_METHOD=SMS_OTP. Re-derives
 * canFranchiseeSignNow exactly like the Aadhaar path (P1-07: no client
 * claim is trusted), with one documented exception: when the franchisee's
 * own latest attempt is already SENT via this exact OTP flow, this is a
 * *resend* of the code already in flight, not an attempt to start a second,
 * competing signing attempt — the gate's "no open attempt" clause exists to
 * block the latter, not the former, so it's deliberately bypassed only in
 * that one case (requestOtp, in turn, reuses the same EsignAttempt row for a
 * resend rather than minting a new attemptNo — see its own comment).
 */
export async function requestFranchiseeLoiOtp(
  onboardingId: string,
  consentAccepted: boolean
): Promise<RequestOtpActionResult> {
  const user = await requireUser();
  if (user.role !== "FRANCHISEE") return { error: "Not authorized." };

  const onboarding = await loadFranchiseeSigningContext(onboardingId, user.id);
  if (!onboarding || !onboarding.currentLoiVersion) return { error: "Not ready to sign." };

  const version = onboarding.currentLoiVersion;
  const latestAttempt = version.attempts[0] ?? null;
  const isContinuingOtpFlow = latestAttempt?.provider === "sms_otp" && latestAttempt.status === "SENT";

  const allowed = canFranchiseeSignNow({
    kycStatus: onboarding.kycStatus,
    paymentStatus: onboarding.paymentStatus,
    verifiedAmount: onboarding.payments[0]?.verifiedAmount ?? null,
    expectedAmount: onboarding.expectedAmount,
    loiVersionStatus: version.status,
    latestFranchiseAttemptStatus: isContinuingOtpFlow ? null : latestAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Signing isn't available right now — check your KYC, payment and LOI status." };

  const { ip, userAgent } = await getRequestMeta();
  const result = await requestOtp({
    onboardingId,
    loiVersionId: version.id,
    loiVersionStatus: version.status,
    loiVersionPdfSha256: version.pdfSha256,
    signerRole: "FRANCHISEE",
    signerUserId: user.id,
    storeLabel: `${onboarding.brand} ${onboarding.proposedLocation}`,
    phoneRaw: onboarding.contactPhone,
    previewOpenedAt: version.franchiseePreviewOpenedAt,
    consentAccepted,
    ip,
    userAgent,
    actor: user,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/onboarding/loi");
  return { ok: true, phoneMasked: result.phoneMasked, expiresAt: result.expiresAt.toISOString() };
}

export async function verifyFranchiseeLoiOtp(
  onboardingId: string,
  code: string,
  consentAccepted: boolean
): Promise<VerifyOtpActionResult> {
  const user = await requireUser();
  if (user.role !== "FRANCHISEE") return { error: "Not authorized." };

  const onboarding = await loadFranchiseeSigningContext(onboardingId, user.id);
  if (!onboarding || !onboarding.currentLoiVersion) return { error: "Not ready to sign." };

  const version = onboarding.currentLoiVersion;
  const latestAttempt = version.attempts[0] ?? null;
  // Re-checked at the moment of verify too (decision 5), with the same
  // documented exception as requestFranchiseeLoiOtp above: we're completing
  // the signer's own in-flight attempt, not starting a new one.
  const isCompletingOwnOtpAttempt = latestAttempt?.provider === "sms_otp" && latestAttempt.status === "SENT";
  const allowed = canFranchiseeSignNow({
    kycStatus: onboarding.kycStatus,
    paymentStatus: onboarding.paymentStatus,
    verifiedAmount: onboarding.payments[0]?.verifiedAmount ?? null,
    expectedAmount: onboarding.expectedAmount,
    loiVersionStatus: version.status,
    latestFranchiseAttemptStatus: isCompletingOwnOtpAttempt ? null : latestAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Signing isn't available right now — check your KYC, payment and LOI status." };

  const { ip, userAgent } = await getRequestMeta();
  const normalizedPhone = normalizePhoneToE164(onboarding.contactPhone);
  const consentText = renderConsentText({
    name: user.name,
    versionNo: version.versionNo,
    pdfSha256: version.pdfSha256,
    phoneMasked: normalizedPhone ? maskPhoneE164(normalizedPhone) : "(no number on file)",
  });

  const result = await verifyOtp({
    onboardingId,
    loiVersionId: version.id,
    currentLoiVersionId: version.id,
    currentPdfSha256: version.pdfSha256,
    signerRole: "FRANCHISEE",
    signerUserId: user.id,
    signerName: user.name,
    code,
    previewOpenedAt: version.franchiseePreviewOpenedAt,
    consentAccepted,
    consentText,
    consentTextVersion: CONSENT_TEXT_VERSION,
    ip,
    userAgent,
    actor: user,
  });
  if (!result.ok) return result;

  revalidatePath("/onboarding/loi");
  return { ok: true };
}

export type LoiFeedbackResult = { error: string } | { ok: true };

/**
 * "I don't want to sign yet, here's why" — a franchisee who has concerns
 * about the LOI (terms, fee, territory, anything) can say so in plain text
 * instead of being left with no option but to either sign or go silent.
 * Goes to whoever can actually act on it: the sales owner who created this
 * onboarding and the LOI preparer(s) who drafted it, plus Admin as a
 * backstop. Not a sign-blocking action — the franchisee can still proceed to
 * sign separately; this is just a message, logged to AuditEvent like every
 * other onboarding action.
 */
export async function submitLoiFeedback(onboardingId: string, message: string): Promise<LoiFeedbackResult> {
  const user = await requireUser();
  if (user.role !== "FRANCHISEE") return { error: "Not authorized." };

  const trimmed = message.trim();
  if (!trimmed) return { error: "Enter a message first." };
  if (trimmed.length > 2000) return { error: "Message is too long (2000 characters max)." };

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId, franchiseeUserId: user.id },
    include: { salesOwner: true },
  });
  if (!onboarding) return { error: "Onboarding not found." };

  const loiPreparers = await db.user.findMany({ where: { role: "LOI_PREPARER", isActive: true } });
  const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true } });
  const recipients = new Map<string, { name: string; email: string }>();
  for (const u of [onboarding.salesOwner, ...loiPreparers, ...admins]) {
    if (u.email) recipients.set(u.email, { name: u.name, email: u.email });
  }

  await writeAuditEvent(db, {
    actor: user,
    onboardingId,
    entityType: "LoiFeedback",
    entityId: onboardingId,
    action: "CREATE",
    newValue: { message: trimmed },
    reference: "Franchisee left a note on the LOI before signing",
  });

  const storeLabel = `${onboarding.brand} ${onboarding.proposedLocation}`;
  const link = `${process.env.APP_URL || "http://localhost:3000"}/store-onboarding/${onboardingId}`;
  for (const r of recipients.values()) {
    await sendOnboardingEmail({
      key: "loi_feedback",
      to: r.email,
      onboardingId,
      vars: { name: r.name, franchiseeName: user.name, store: storeLabel, message: trimmed, link },
    });
  }

  return { ok: true };
}
