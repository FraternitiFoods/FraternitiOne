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
    actorUserId: user.id,
    invitedSignerUserId: latestCompanyAttempt?.signerUserId ?? null,
    franchiseAttempt: franchiseAttempt
      ? { status: franchiseAttempt.status, loiVersionId: franchiseAttempt.loiVersionId, pdfSha256: franchiseAttempt.pdfSha256 }
      : null,
    loiVersion: { id: version.id, pdfSha256: version.pdfSha256 },
    latestCompanyAttemptStatus: latestCompanyAttempt?.status ?? null,
  });
  if (!allowed) return { error: "Company sign isn't available right now." };

  // plan.md section 19 decision 4: under Leegality, startFranchiseeEsign
  // already invited this exact signatory onto the shared document and saved
  // their signUrl — reuse it rather than creating a second document (which
  // would spend more credits and break the one-document/two-invitee model).
  if (currentProviderName() === "leegality") {
    if (!latestCompanyAttempt?.providerSignUrl || latestCompanyAttempt.status !== "SENT") {
      return { error: "The company signing link isn't ready yet — ask Admin to check the e-sign status on this LOI." };
    }
    revalidatePath(`/signing/${onboardingId}`);
    return { signingUrl: latestCompanyAttempt.providerSignUrl };
  }

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

