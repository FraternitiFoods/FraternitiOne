"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFranchiseeSignNow, transitionLoiVersion, transitionEsignAttempt } from "@/lib/onboarding/state";
import { getEsignProvider } from "@/lib/esign";
import { getObjectBuffer } from "@/lib/storage";

export type StartSignResult = { error: string } | { signingUrl: string };

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

  revalidatePath("/onboarding/loi");
  return { signingUrl };
}
