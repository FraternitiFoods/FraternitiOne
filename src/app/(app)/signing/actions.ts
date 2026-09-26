"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canCompanySign } from "@/lib/permissions";
import { canCompanySignNow, transitionEsignAttempt } from "@/lib/onboarding/state";
import { getEsignProvider } from "@/lib/esign";
import { getObjectBuffer } from "@/lib/storage";

export type StartSignResult = { error: string } | { signingUrl: string };

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

  revalidatePath(`/signing/${onboardingId}`);
  return { signingUrl };
}
