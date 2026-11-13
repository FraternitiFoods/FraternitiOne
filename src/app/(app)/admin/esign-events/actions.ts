"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageOnboardingAdmin } from "@/lib/permissions";
import { getEsignProvider } from "@/lib/esign";
import { processEsignEvent } from "@/lib/esign/webhook-processor";

export type ReconcileResult = { error?: string; outcome?: string };

/**
 * plan.md section 17 "Manual reconcile (Admin)": calls getStatus() on the
 * provider and marks complete only if the provider itself reports COMPLETED
 * and the hash matches — otherwise records the discrepancy and changes
 * nothing. Routes through the same processEsignEvent the real webhook uses
 * (signatureValid=true here because this is a direct, authenticated call to
 * the provider's own API, not an unverified inbound payload) so there is
 * exactly one place that decides what a status means. Doubles as the
 * "retryable" mechanism for a failed webhook (P1-10) — it re-asks the
 * provider for the current truth rather than replaying the old payload
 * verbatim, which also sidesteps the (provider, providerEventId) dedup
 * ledger correctly recognizing a literal replay as a harmless duplicate.
 */
export async function reconcileAttempt(attemptId: string): Promise<ReconcileResult> {
  const user = await requireUser();
  if (!canManageOnboardingAdmin(user)) {
    return { error: "You don't have permission to do this." };
  }

  const attempt = await db.esignAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || !attempt.providerEnvelopeId) {
    return { error: "No envelope to reconcile." };
  }

  let provider;
  try {
    provider = getEsignProvider();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "E-sign provider not configured." };
  }

  try {
    const status = await provider.getStatus(attempt.providerEnvelopeId);
    const result = await processEsignEvent(
      {
        eventId: `reconcile_${randomUUID()}`,
        envelopeId: attempt.providerEnvelopeId,
        status: status.status,
        documentSha256: status.documentSha256,
      },
      true
    );
    revalidatePath("/admin/esign-events");
    return { outcome: result.outcome + (result.message ? `: ${result.message}` : "") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Reconcile failed." };
  }
}
