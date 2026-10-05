"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFranchiseeSignNow, transitionLoiVersion, transitionEsignAttempt } from "@/lib/onboarding/state";
import { getEsignProvider, currentProviderName } from "@/lib/esign";
import { processEsignEvent } from "@/lib/esign/webhook-processor";
import { getObjectBuffer } from "@/lib/storage";
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
        include: { attempts: { orderBy: { attemptNo: "desc" } } },
      },
    },
  });
  if (!onboarding || !onboarding.currentLoiVersion) return { error: "Not ready to sign." };

  const version = onboarding.currentLoiVersion;
  const latestAttempt = version.attempts.find((a) => a.signerRole === "FRANCHISEE") ?? null;
  const latestCompanyAttempt = version.attempts.find((a) => a.signerRole === "COMPANY") ?? null;

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

  const providerName = currentProviderName();
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  // plan.md section 19 decision 4: Leegality needs the company signatory's
  // identity up front, to invite them as invitee 2 in the same call. The app
  // has no per-onboarding assignment for this role (blocker 6) — only one
  // active COMPANY_SIGNATORY is a supported configuration for now; more than
  // one is ambiguous and is surfaced to Admin rather than guessed at.
  let coSignerUser: { id: string; name: string; email: string } | null = null;
  if (providerName === "leegality") {
    const signatories = await db.user.findMany({ where: { role: "COMPANY_SIGNATORY", isActive: true } });
    if (signatories.length === 0) {
      return { error: "No company signatory is set up yet — ask Admin to add a user with the Company Signatory role." };
    }
    if (signatories.length > 1) {
      return { error: "More than one company signatory is configured — ask Admin to resolve this before starting e-sign." };
    }
    const [s] = signatories;
    if (!s.email) return { error: "The company signatory has no email on file — ask Admin to add one." };
    coSignerUser = { id: s.id, name: s.name, email: s.email };
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
  let coSigningUrl: string | undefined;
  try {
    const pdfBytes = await getObjectBuffer(version.pdfB2Key);
    const created = await provider.createEnvelope({
      attemptId: attempt.id,
      signer: { name: user.name, email: user.email ?? "", role: "FRANCHISEE" },
      coSigner: coSignerUser ? { name: coSignerUser.name, email: coSignerUser.email, role: "COMPANY" } : undefined,
      pdf: Buffer.from(pdfBytes),
      pdfSha256: version.pdfSha256,
      authMode: process.env.COMPANY_SIGN_MODE || "AADHAAR_ESIGN",
    });
    envelopeId = created.envelopeId;
    signingUrl = created.signingUrl;
    coSigningUrl = created.coSigningUrl;
  } catch (err) {
    await db.esignAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
    return { error: err instanceof Error ? err.message : "Failed to start e-sign." };
  }

  // plan.md section 19 "Leegality API contract": after signing, send the
  // signer back to our app via `?redirectUrl=`. Mock's signingUrl is already
  // our own /dev/mock-esign page, so this is a no-op there.
  if (providerName === "leegality") {
    signingUrl = `${signingUrl}?redirectUrl=${encodeURIComponent(`${appUrl}/onboarding/loi`)}`;
    if (coSigningUrl) {
      coSigningUrl = `${coSigningUrl}?redirectUrl=${encodeURIComponent(`${appUrl}/signing/${onboardingId}`)}`;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.esignAttempt.update({
      where: { id: attempt.id },
      data: {
        providerEnvelopeId: envelopeId,
        providerSignUrl: providerName === "leegality" ? signingUrl : null,
        status: transitionEsignAttempt("NOT_STARTED", "SEND"),
        sentAt: new Date(),
      },
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

    // plan.md section 19 decision 4: pre-create the COMPANY attempt now,
    // sharing this same Leegality document, so startCompanyEsign (below)
    // can hand the already-invited signatory their link without a second
    // provider call (and without spending more credits).
    if (providerName === "leegality" && coSignerUser && coSigningUrl) {
      await tx.esignAttempt.create({
        data: {
          loiVersionId: version.id,
          signerRole: "COMPANY",
          attemptNo: (latestCompanyAttempt?.attemptNo ?? 0) + 1,
          provider: providerName,
          providerEnvelopeId: envelopeId,
          providerSignUrl: coSigningUrl,
          pdfSha256: version.pdfSha256,
          status: transitionEsignAttempt("NOT_STARTED", "SEND"),
          signerUserId: coSignerUser.id,
          sentAt: new Date(),
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
