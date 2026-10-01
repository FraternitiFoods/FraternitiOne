import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { transitionEsignAttempt, transitionLoiVersion } from "@/lib/onboarding/state";
import { processEsignEvent } from "@/lib/esign/webhook-processor";
import { getSmsProvider } from "@/lib/sms";
import type { CurrentUser } from "@/lib/session";
import type { EsignSignerRole, LoiVersionStatus } from "@prisma/client";
import {
  generateOtpCode,
  hashOtpCode,
  evaluateOtpSend,
  evaluateOtpVerify,
  shouldSupersedeOnResend,
} from "./core";
import { OTP_TTL_MINUTES, OTP_SEND_WINDOW_MINUTES, OTP_MAX_ATTEMPTS } from "./limits";
import { normalizePhoneToE164, maskPhoneE164 } from "./phone";

/**
 * plan.md section 19 "What gets built" #4 — the DB-aware wrapper around the
 * pure decisions in core.ts, shared by both signer roles (the franchisee
 * action in src/app/onboarding/loi/actions.ts and the company action in
 * src/app/(app)/signing/actions.ts each resolve role-specific data — which
 * onboarding, which phone number, is the actor allowed to sign right now —
 * then call these two functions). Same split as state.ts (pure) vs. its
 * server-action callers.
 */

function requireOtpSecret(): string {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) throw new Error("OTP_HMAC_SECRET is not set — see .env.example.");
  return secret;
}

export type RequestOtpInput = {
  onboardingId: string;
  loiVersionId: string;
  loiVersionStatus: LoiVersionStatus;
  loiVersionPdfSha256: string;
  signerRole: EsignSignerRole;
  signerUserId: string;
  storeLabel: string;
  phoneRaw: string | null;
  /** section 19 "Rules checked at both request and verify time": not just at verify. */
  previewOpenedAt: Date | null;
  consentAccepted: boolean;
  ip: string | null;
  userAgent: string | null;
  actor: CurrentUser;
};

export type RequestOtpResult =
  | { ok: true; phoneMasked: string; expiresAt: Date }
  | { ok: false; error: string };

export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  if (!input.previewOpenedAt) {
    return { ok: false, error: "Please open the LOI preview before requesting a code." };
  }

  const phoneE164 = input.phoneRaw ? normalizePhoneToE164(input.phoneRaw) : null;
  if (!phoneE164) {
    return {
      ok: false,
      error:
        input.signerRole === "FRANCHISEE"
          ? "No valid mobile number on file — contact Sales/Admin to update it."
          : "No valid mobile number on file for the company signatory — ask Admin to add one.",
    };
  }

  const windowStart = new Date(Date.now() - OTP_SEND_WINDOW_MINUTES * 60_000);
  const [sendsInWindow, latestChallenge, latestAttempt] = await Promise.all([
    db.otpChallenge.count({
      where: { loiVersionId: input.loiVersionId, signerRole: input.signerRole, createdAt: { gte: windowStart } },
    }),
    db.otpChallenge.findFirst({
      where: { loiVersionId: input.loiVersionId, signerRole: input.signerRole },
      orderBy: { createdAt: "desc" },
    }),
    db.esignAttempt.findFirst({
      where: { loiVersionId: input.loiVersionId, signerRole: input.signerRole },
      orderBy: { attemptNo: "desc" },
    }),
  ]);

  const now = new Date();
  const sendCheck = evaluateOtpSend({
    lastSentAt: latestChallenge?.lastSentAt ?? null,
    sendsInWindow,
    now,
  });
  if (!sendCheck.allowed) {
    return {
      ok: false,
      error:
        sendCheck.reason === "COOLDOWN"
          ? `Please wait ${sendCheck.retryAfterSeconds}s before requesting another code.`
          : "Too many codes requested for this document — try again in a while.",
    };
  }

  const challengeId = randomUUID();
  const code = generateOtpCode();
  const codeHash = hashOtpCode(requireOtpSecret(), challengeId, code);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

  // A resend (the signer's existing attempt is already SENT — an earlier
  // code for the same attempt just expired/was wrong) reuses the SAME
  // EsignAttempt row, just repointing providerEnvelopeId at the new
  // challenge — it is not a new signing attempt, so it doesn't get a new
  // attemptNo. A brand-new attempt (none yet, or the last one ended
  // FAILED/EXPIRED/CANCELLED) gets attemptNo + 1, same restart rule as the
  // Aadhaar flow (state.ts: "a failed/expired attempt can be restarted as
  // attempt n+1"). The calling action is responsible for never reaching here
  // with a latestAttempt already COMPLETED — same responsibility
  // startFranchiseeEsign/startCompanyEsign already carry today.
  const isResend = latestAttempt?.status === "SENT";

  // Consent is only asked once per attempt, on the screen that starts it —
  // a resend continues an attempt the signer already consented to start,
  // and the UI has no consent checkbox to re-tick on that screen at all
  // (initiallySent skips straight past it). Enforcing it here unconditionally
  // would make every resend fail with a confusing "please agree" error.
  if (!isResend && !input.consentAccepted) {
    return { ok: false, error: "Please confirm you have read and agree to the LOI first." };
  }

  await db.$transaction(async (tx) => {
    if (latestChallenge && shouldSupersedeOnResend(latestChallenge.status)) {
      await tx.otpChallenge.update({ where: { id: latestChallenge.id }, data: { status: "SUPERSEDED" } });
    }

    await tx.otpChallenge.create({
      data: {
        id: challengeId,
        onboardingId: input.onboardingId,
        loiVersionId: input.loiVersionId,
        signerRole: input.signerRole,
        signerUserId: input.signerUserId,
        phoneE164,
        codeHash,
        pdfSha256: input.loiVersionPdfSha256,
        expiresAt,
        status: "PENDING",
        sendCount: sendsInWindow + 1,
        lastSentAt: now,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    if (isResend) {
      await tx.esignAttempt.update({
        where: { id: latestAttempt!.id },
        data: { providerEnvelopeId: challengeId, sentAt: now },
      });
    } else {
      await tx.esignAttempt.create({
        data: {
          loiVersionId: input.loiVersionId,
          signerRole: input.signerRole,
          attemptNo: (latestAttempt?.attemptNo ?? 0) + 1,
          provider: "sms_otp",
          providerEnvelopeId: challengeId,
          pdfSha256: input.loiVersionPdfSha256,
          status: transitionEsignAttempt("NOT_STARTED", "SEND"),
          signerUserId: input.signerUserId,
          sentAt: now,
        },
      });
    }

    // Franchisee's first send moves the LOI into signing, same transition
    // startFranchiseeEsign makes for the Aadhaar path — company sends never
    // touch LoiVersion.status (it only moves on FRANCHISE_SIGN/COMPANY_SIGN,
    // via processEsignEvent).
    if (input.signerRole === "FRANCHISEE" && input.loiVersionStatus === "RELEASED") {
      await tx.loiVersion.update({
        where: { id: input.loiVersionId },
        data: { status: transitionLoiVersion(input.loiVersionStatus, "SEND_FOR_SIGNING") },
      });
      await writeAuditEvent(tx, {
        actor: input.actor,
        onboardingId: input.onboardingId,
        entityType: "LoiVersion",
        entityId: input.loiVersionId,
        action: "UPDATE",
        oldValue: { status: "RELEASED" },
        newValue: { status: "SENT_FOR_SIGNING" },
        reference: "Sent for OTP signing",
      });
    }

    await writeAuditEvent(tx, {
      actor: input.actor,
      onboardingId: input.onboardingId,
      entityType: "OtpChallenge",
      entityId: challengeId,
      action: "CREATE",
      newValue: { signerRole: input.signerRole, phoneMasked: maskPhoneE164(phoneE164) },
      reference: isResend ? "OTP resent" : "OTP requested",
    });
  });

  try {
    const provider = getSmsProvider();
    await provider.send({ to: phoneE164, templateKey: "LOI_OTP", vars: { code, store: input.storeLabel } });
  } catch (err) {
    // section 19 "SMS adapter": "do not leave a pending challenge that looks
    // sent" — delete the challenge (it never actually went out, so it
    // shouldn't count against the send-window cap either). A brand-new
    // attempt that never successfully sent is marked FAILED, same as a
    // createEnvelope failure in the Aadhaar flow; a resend whose re-send
    // failed leaves the existing SENT attempt alone — it's still mid-flow,
    // just without a currently-valid challenge, and the next "Send OTP"
    // click is itself treated as another resend.
    await db.$transaction(async (tx) => {
      await tx.otpChallenge.delete({ where: { id: challengeId } }).catch(() => {});
      if (!isResend) {
        await tx.esignAttempt.updateMany({
          where: { providerEnvelopeId: challengeId },
          data: { status: "FAILED" },
        });
      }
      await writeAuditEvent(tx, {
        actor: input.actor,
        onboardingId: input.onboardingId,
        entityType: "OtpChallenge",
        entityId: challengeId,
        action: "UPDATE",
        reference: `OTP send failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
    return { ok: false, error: "Could not send OTP, try again." };
  }

  return { ok: true, phoneMasked: maskPhoneE164(phoneE164), expiresAt };
}

export type VerifyOtpInput = {
  onboardingId: string;
  loiVersionId: string;
  currentLoiVersionId: string;
  currentPdfSha256: string;
  signerRole: EsignSignerRole;
  signerUserId: string;
  signerName: string;
  code: string;
  previewOpenedAt: Date | null;
  consentAccepted: boolean;
  consentText: string;
  consentTextVersion: number;
  ip: string | null;
  userAgent: string | null;
  actor: CurrentUser;
};

export type VerifyOtpResult = { ok: true } | { ok: false; error: string; locked?: boolean };

export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  if (!input.previewOpenedAt) {
    return { ok: false, error: "Please open the LOI preview before entering the code." };
  }
  // Consent is enforced once, at requestOtp (the action that actually sends
  // the SMS) — deliberately NOT re-enforced here. Unlike previewOpenedAt
  // (persisted on LoiVersion, so it's visible from any tab/session),
  // consentAccepted is a client-only signal with no server-side record of
  // "this specific session ticked the box." Re-requiring it here would mean
  // a page reload, or a second tab opened mid-flow (both land straight on
  // the code-entry step via initiallySent, skipping the consent screen
  // entirely), could never verify again — a dead end, not a meaningful
  // extra safeguard, since a challenge can't exist at all unless an earlier
  // request already proved consent.

  // Scoped by onboardingId, NOT loiVersionId: if the LOI version changed
  // since this signer's code was sent (preparer released a new version),
  // their old challenge now belongs to a *different* loiVersionId than the
  // current one — looking it up by the CURRENT version's id would find
  // nothing and report the wrong reason ("no OTP sent yet" instead of "LOI
  // changed"). Scoping by onboarding+role always finds their actual latest
  // challenge; evaluateOtpVerify's own loiVersionId/pdfSha256 comparison
  // (below) is what correctly turns that into VERSION_MISMATCH.
  const challenge = await db.otpChallenge.findFirst({
    where: { onboardingId: input.onboardingId, signerRole: input.signerRole },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) {
    return { ok: false, error: "No OTP has been sent yet — request one first." };
  }

  const now = new Date();
  const outcome = evaluateOtpVerify(
    {
      id: challenge.id,
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      codeHash: challenge.codeHash,
      loiVersionId: challenge.loiVersionId,
      pdfSha256: challenge.pdfSha256,
    },
    {
      code: input.code,
      now,
      secret: requireOtpSecret(),
      currentLoiVersionId: input.currentLoiVersionId,
      currentPdfSha256: input.currentPdfSha256,
    }
  );

  switch (outcome.result) {
    case "ALREADY_USED":
      return { ok: false, error: "This code has already been used or replaced — request a new one." };
    case "LOCKED":
      return { ok: false, error: "Too many wrong attempts — request a new code.", locked: true };
    case "EXPIRED": {
      if (challenge.status === "PENDING") {
        await db.otpChallenge.update({ where: { id: challenge.id }, data: { status: "EXPIRED" } });
        await writeAuditEvent(db, {
          actor: input.actor,
          onboardingId: input.onboardingId,
          entityType: "OtpChallenge",
          entityId: challenge.id,
          action: "UPDATE",
          newValue: { status: "EXPIRED" },
          reference: "OTP expired",
        });
      }
      return { ok: false, error: "This code has expired — request a new one." };
    }
    case "VERSION_MISMATCH":
      return { ok: false, error: "The LOI has changed since this code was sent — request a new one." };
    case "WRONG_CODE": {
      const nextStatus = outcome.locked ? "LOCKED" : "PENDING";
      await db.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: outcome.attempts, status: nextStatus },
      });
      await writeAuditEvent(db, {
        actor: input.actor,
        onboardingId: input.onboardingId,
        entityType: "OtpChallenge",
        entityId: challenge.id,
        action: "UPDATE",
        newValue: { status: nextStatus, attempts: outcome.attempts },
        reference: outcome.locked ? "OTP locked after too many wrong attempts" : "Wrong OTP attempt",
      });
      return outcome.locked
        ? { ok: false, error: "Too many wrong attempts — request a new code.", locked: true }
        : { ok: false, error: `Wrong code — ${OTP_MAX_ATTEMPTS - outcome.attempts} attempt(s) left.` };
    }
  }

  // VERIFIED — record the evidence first (our own transaction, committed
  // before processEsignEvent runs its own), then drive the exact same
  // completion path the Aadhaar/webhook flow uses.
  await db.$transaction(async (tx) => {
    await tx.otpChallenge.update({ where: { id: challenge.id }, data: { status: "VERIFIED" } });
    const acceptance = await tx.loiAcceptance.create({
      data: {
        loiVersionId: input.loiVersionId,
        signerRole: input.signerRole,
        signerUserId: input.signerUserId,
        signerName: input.signerName,
        phoneMasked: maskPhoneE164(challenge.phoneE164),
        otpChallengeId: challenge.id,
        ip: input.ip,
        userAgent: input.userAgent,
        pdfSha256: input.currentPdfSha256,
        consentText: input.consentText,
        consentTextVersion: input.consentTextVersion,
        previewOpenedAt: input.previewOpenedAt,
      },
    });
    await writeAuditEvent(tx, {
      actor: input.actor,
      onboardingId: input.onboardingId,
      entityType: "LoiAcceptance",
      entityId: acceptance.id,
      action: "CREATE",
      newValue: { signerRole: input.signerRole, otpChallengeId: challenge.id },
      reference: "OTP verified — LOI accepted",
    });
  });

  await processEsignEvent(
    { eventId: challenge.id, envelopeId: challenge.id, status: "COMPLETED", documentSha256: input.currentPdfSha256 },
    true,
    "sms_otp"
  );

  return { ok: true };
}
