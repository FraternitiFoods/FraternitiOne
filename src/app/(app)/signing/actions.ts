"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canCompanySign } from "@/lib/permissions";
import { canCompanySignNow, transitionEsignAttempt } from "@/lib/onboarding/state";
import { getEsignProvider, currentProviderName } from "@/lib/esign";
import { processEsignEvent } from "@/lib/esign/webhook-processor";
import { getObjectBuffer } from "@/lib/storage";
import { requestOtp, verifyOtp } from "@/lib/otp/challenge";
import { getRequestMeta } from "@/lib/otp/request-meta";
import { renderConsentText, CONSENT_TEXT_VERSION } from "@/lib/otp/consent";
import { normalizePhoneToE164, maskPhoneE164 } from "@/lib/otp/phone";

export type StartSignResult = { error: string } | { signingUrl: string; autoCompleted?: boolean };

/** P1-08: company sign only on the same version + hash after the franchisee completed. Re-checked server-side. */
export async function startCompanyEsign(onboardingId: string): Promise<StartSignResult> {
  const user = await requireUser();
  if (!canCompanySign(user)) return { error: "Not authorized." };

  const onboarding = await db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: {
      currentLoiVersion: {
        include: { attempts: { orderBy: { attemptNo: "desc" } } },
      },
    },
  });
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "No LOI version to sign." };

  const franchiseAttempt = version.attempts.find((a) => a.signerRole === "FRANCHISEE") ?? null;
  const latestCompanyAttempt = version.attempts.find((a) => a.signerRole === "COMPANY") ?? null;

  const allowed = canCompanySignNow({
    actorRole: user.role,
    franchiseAttempt: franchiseAttempt
      ? { status: franchiseAttempt.status, loiVersionId: franchiseAttempt.loiVersionId, pdfSha256: franchiseAttempt.pdfSha256 }
      : null,
    loiVersion: { id: version.id, pdfSha256: version.pdfSha256 },
    latestCompanyAttemptStatus: latestCompanyAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Company sign isn't available right now." };

  let provider;
  try {
    provider = getEsignProvider();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "E-sign is not configured." };
  }

  const attempt = await db.esignAttempt.create({
    data: {
      loiVersionId: version.id,
      signerRole: "COMPANY",
      attemptNo: (latestCompanyAttempt?.attemptNo ?? 0) + 1,
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
      signer: { name: user.name, email: user.email ?? "", role: "COMPANY" },
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

  await db.esignAttempt.update({
    where: { id: attempt.id },
    data: { providerEnvelopeId: envelopeId, status: transitionEsignAttempt("NOT_STARTED", "SEND"), sentAt: new Date() },
  });
  await db.auditEvent.create({
    data: {
      onboardingId,
      actorId: user.id,
      actorEmail: user.email ?? "(no email on file)",
      actorName: user.name,
      actorRole: user.role,
      entityType: "EsignAttempt",
      entityId: attempt.id,
      action: "CREATE",
      newValue: { signerRole: "COMPANY", attemptNo: attempt.attemptNo, envelopeId },
      reference: "Company signatory started Aadhaar e-sign",
      source: "web",
    },
  });

  // Testing convenience while no real vendor is wired up yet — see the
  // matching comment in onboarding/loi/actions.ts's startFranchiseeEsign.
  let autoCompleted = false;
  if (currentProviderName() === "mock") {
    await processEsignEvent(
      { eventId: randomUUID(), envelopeId, status: "COMPLETED", documentSha256: version.pdfSha256 },
      true
    );
    autoCompleted = true;
  }

  revalidatePath(`/signing/${onboardingId}`);
  return { signingUrl, autoCompleted };
}

export type RequestOtpActionResult = { error: string } | { ok: true; phoneMasked: string; expiresAt: string };
export type VerifyOtpActionResult = { error: string; locked?: boolean } | { ok: true };

async function loadCompanySigningContext(onboardingId: string) {
  return db.storeOnboarding.findUnique({
    where: { id: onboardingId },
    include: { currentLoiVersion: { include: { attempts: { orderBy: { attemptNo: "desc" } } } } },
  });
}

/** plan.md section 19 — the OTP equivalent of startCompanyEsign above, used when SIGNING_METHOD=SMS_OTP. Same resend/re-check exception as the franchisee action — see its own comment. */
export async function requestCompanyLoiOtp(
  onboardingId: string,
  consentAccepted: boolean
): Promise<RequestOtpActionResult> {
  const user = await requireUser();
  if (!canCompanySign(user)) return { error: "Not authorized." };

  const onboarding = await loadCompanySigningContext(onboardingId);
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "No LOI version to sign." };

  const franchiseAttempt = version.attempts.find((a) => a.signerRole === "FRANCHISEE") ?? null;
  const latestCompanyAttempt = version.attempts.find((a) => a.signerRole === "COMPANY") ?? null;
  const isContinuingOtpFlow = latestCompanyAttempt?.provider === "sms_otp" && latestCompanyAttempt.status === "SENT";

  const allowed = canCompanySignNow({
    actorRole: user.role,
    franchiseAttempt: franchiseAttempt
      ? { status: franchiseAttempt.status, loiVersionId: franchiseAttempt.loiVersionId, pdfSha256: franchiseAttempt.pdfSha256 }
      : null,
    loiVersion: { id: version.id, pdfSha256: version.pdfSha256 },
    latestCompanyAttemptStatus: isContinuingOtpFlow ? null : latestCompanyAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Company sign isn't available right now." };

  // CurrentUser (the session object) doesn't carry `phone` — fetched
  // separately here, same as any other field the session type deliberately
  // keeps minimal.
  const signatory = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });

  const { ip, userAgent } = await getRequestMeta();
  const result = await requestOtp({
    onboardingId,
    loiVersionId: version.id,
    loiVersionStatus: version.status,
    loiVersionPdfSha256: version.pdfSha256,
    signerRole: "COMPANY",
    signerUserId: user.id,
    storeLabel: `${onboarding.brand} ${onboarding.proposedLocation}`,
    phoneRaw: signatory.phone,
    previewOpenedAt: version.companyPreviewOpenedAt,
    consentAccepted,
    ip,
    userAgent,
    actor: user,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/signing/${onboardingId}`);
  return { ok: true, phoneMasked: result.phoneMasked, expiresAt: result.expiresAt.toISOString() };
}

export async function verifyCompanyLoiOtp(
  onboardingId: string,
  code: string,
  consentAccepted: boolean
): Promise<VerifyOtpActionResult> {
  const user = await requireUser();
  if (!canCompanySign(user)) return { error: "Not authorized." };

  const onboarding = await loadCompanySigningContext(onboardingId);
  const version = onboarding?.currentLoiVersion;
  if (!onboarding || !version) return { error: "No LOI version to sign." };

  const franchiseAttempt = version.attempts.find((a) => a.signerRole === "FRANCHISEE") ?? null;
  const latestCompanyAttempt = version.attempts.find((a) => a.signerRole === "COMPANY") ?? null;
  const isCompletingOwnOtpAttempt = latestCompanyAttempt?.provider === "sms_otp" && latestCompanyAttempt.status === "SENT";

  const allowed = canCompanySignNow({
    actorRole: user.role,
    franchiseAttempt: franchiseAttempt
      ? { status: franchiseAttempt.status, loiVersionId: franchiseAttempt.loiVersionId, pdfSha256: franchiseAttempt.pdfSha256 }
      : null,
    loiVersion: { id: version.id, pdfSha256: version.pdfSha256 },
    latestCompanyAttemptStatus: isCompletingOwnOtpAttempt ? null : latestCompanyAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Company sign isn't available right now." };

  const signatory = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });

  const { ip, userAgent } = await getRequestMeta();
  const normalizedPhone = signatory.phone ? normalizePhoneToE164(signatory.phone) : null;
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
    signerRole: "COMPANY",
    signerUserId: user.id,
    signerName: user.name,
    code,
    previewOpenedAt: version.companyPreviewOpenedAt,
    consentAccepted,
    consentText,
    consentTextVersion: CONSENT_TEXT_VERSION,
    ip,
    userAgent,
    actor: user,
  });
  if (!result.ok) return result;

  revalidatePath(`/signing/${onboardingId}`);
  return { ok: true };
}
