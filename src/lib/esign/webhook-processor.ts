import "server-only";

import { db } from "@/lib/db";
import { transitionEsignAttempt, transitionLoiVersion, type EsignAttemptEvent } from "@/lib/onboarding/state";
import { recomputeOnboardingStatus } from "@/lib/onboarding/recompute";
import { sendOnboardingEmail, type EmailKey } from "@/lib/onboarding/notify";
import { getEsignProvider, currentProviderName } from "./index";
import { uploadDocument } from "@/lib/storage";
import { convertOnboardingToProject } from "@/lib/onboarding/conversion";
import type { ParsedWebhookEvent } from "./provider";
import type { Prisma } from "@prisma/client";

/**
 * System-actor audit events (webhook processing has no signed-in user) —
 * writes directly rather than through writeAuditEvent, whose `actor`
 * parameter requires a real User id (CurrentUser.id is a non-null string;
 * AuditEvent.actorId is nullable at the schema level specifically for this
 * case). "system:esign" matches the schema's own doc comment for system
 * actor emails.
 */
async function writeSystemAuditEvent(
  tx: Prisma.TransactionClient,
  input: {
    onboardingId: string;
    entityType: string;
    entityId: string;
    action: "CREATE" | "UPDATE";
    oldValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    reference: string;
  }
) {
  await tx.auditEvent.create({
    data: {
      onboardingId: input.onboardingId,
      actorId: null,
      actorEmail: "system:esign",
      actorName: "E-sign provider",
      actorRole: "ADMIN",
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      oldValue: input.oldValue,
      newValue: input.newValue,
      reference: input.reference,
      source: "system:esign",
    },
  });
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"]);

const ATTEMPT_EVENT_MAP: Record<string, EsignAttemptEvent | null> = {
  SENT: null,
  IN_PROGRESS: "PROVIDER_START",
  COMPLETED: "COMPLETE",
  FAILED: "FAIL",
  EXPIRED: "EXPIRE",
  CANCELLED: "CANCEL",
};

/** plan.md section 19 "Idempotency key" — the event-kind half of `leegality:<documentId>:<ROLE>:<kind>`. */
const LEEGALITY_EVENT_KIND: Record<string, string> = {
  COMPLETED: "signed",
  CANCELLED: "rejected",
  EXPIRED: "expired",
  FAILED: "failed",
  SENT: "sent",
  IN_PROGRESS: "in_progress",
};

/**
 * plan.md section 19 webhook "Store less" rule — `invitationUrl` is a bearer
 * secret (a sign link) and must never be persisted or logged, even inside
 * the raw EsignEvent payload. `verification` (Aadhaar-derived PII) never
 * reaches this far at all — LeegalityProvider.parseAndVerifyWebhook never
 * includes it on `ParsedWebhookEvent` in the first place.
 */
function redactForStorage(parsed: ParsedWebhookEvent): Prisma.InputJsonValue {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { invitationUrl: _invitationUrl, ...rest } = parsed;
  return rest as unknown as Prisma.InputJsonValue;
}

type PendingNotification = { key: EmailKey; to: string; onboardingId: string; vars: Record<string, string> };

export type ProcessOutcome = {
  outcome: "PROCESSED" | "IGNORED_LATE" | "DUPLICATE" | "FAILED";
  message?: string;
};

/**
 * plan.md section 19 decision 6 ("the webhook is a doorbell, not proof") +
 * "Which signer" + "Idempotency key". Leegality-only, runs before the
 * dedup check and before opening any DB transaction (a network call must
 * never happen inside an interactive Postgres transaction — same discipline
 * as `handleAttemptCompleted`'s own comment below about Resend). Resolves
 * which EsignAttempt this event is about (two attempts can share one
 * `providerEnvelopeId` under decision 4), confirms the status directly with
 * Leegality rather than trusting the webhook body, and builds the final
 * `leegality:<documentId>:<ROLE>:<kind>` idempotency key.
 */
async function resolveLeegalityEvent(
  parsed: ParsedWebhookEvent
): Promise<{ attemptId: string; confirmedParsed: ParsedWebhookEvent; idempotencyKey: string }> {
  const candidates = await db.esignAttempt.findMany({
    where: { providerEnvelopeId: parsed.envelopeId },
    include: { signerUser: true },
  });
  if (candidates.length === 0) {
    throw new Error("Unknown Leegality document — no matching EsignAttempt.");
  }

  let attempt =
    candidates.find((c) => c.providerSignUrl && parsed.invitationUrl && c.providerSignUrl === parsed.invitationUrl) ??
    (parsed.inviteeEmail ? candidates.find((c) => c.signerUser?.email === parsed.inviteeEmail) : undefined);
  if (!attempt) {
    if (candidates.length === 1) {
      attempt = candidates[0];
    } else {
      throw new Error("Could not determine which signer this Leegality webhook is about.");
    }
  }

  const provider = getEsignProvider();
  const { status: confirmedStatus } = await provider.getStatus(parsed.envelopeId);

  const kind = LEEGALITY_EVENT_KIND[confirmedStatus] ?? "sent";
  const idempotencyKey = `leegality:${parsed.envelopeId}:${attempt.signerRole}:${kind}`;

  return { attemptId: attempt.id, confirmedParsed: { ...parsed, status: confirmedStatus }, idempotencyKey };
}

/**
 * plan.md section 17 "Webhook route rules" — shared by the real webhook
 * route (POST /api/webhooks/esign) and the Admin manual reconcile action, so
 * there's exactly one place that decides what a provider status update
 * means, not two that could disagree. All DB state changes happen in one
 * transaction; duplicate/late events are recorded but change nothing
 * (P1-10). Emails are collected during the transaction and sent only after
 * it commits — Resend is a network call, and holding one open inside an
 * interactive Postgres transaction risks Prisma's default 5s timeout (same
 * "send after commit" discipline as createOnboarding's own invite email).
 */
export async function processEsignEvent(
  parsed: ParsedWebhookEvent,
  signatureValid: boolean,
  /**
   * Lets a caller label an event under a specific provider name instead of
   * whatever ESIGN_PROVIDER happens to be set to (currentProviderName()'s
   * only source) — every current caller (the real webhook route, Admin
   * reconcile, the mock-autocomplete convenience in
   * startFranchiseeEsign/startCompanyEsign) omits this and gets the default.
   */
  providerNameOverride?: string
): Promise<ProcessOutcome> {
  const providerName = providerNameOverride ?? currentProviderName();

  let idempotencyKey = parsed.eventId;
  let effectiveParsed = parsed;
  let attemptIdHint: string | undefined;

  if (providerName === "leegality") {
    try {
      const resolved = await resolveLeegalityEvent(parsed);
      idempotencyKey = resolved.idempotencyKey;
      effectiveParsed = resolved.confirmedParsed;
      attemptIdHint = resolved.attemptId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Leegality webhook resolution failed:", err);
      await db.esignEvent.create({
        data: {
          provider: providerName,
          providerEventId: parsed.eventId,
          envelopeId: parsed.envelopeId,
          payload: redactForStorage(parsed),
          signatureValid,
          processingStatus: "FAILED",
          error: message,
        },
      });
      return { outcome: "FAILED", message };
    }
  }

  const existing = await db.esignEvent.findUnique({
    where: { provider_providerEventId: { provider: providerName, providerEventId: idempotencyKey } },
  });
  if (existing) {
    return { outcome: "DUPLICATE" };
  }

  let outcome: { result: ProcessOutcome; notifications: PendingNotification[] };
  try {
    outcome = await db.$transaction(async (tx) => {
      return processWithinTransaction(tx, effectiveParsed, signatureValid, providerName, idempotencyKey, attemptIdHint);
    });
  } catch (err) {
    // A real failure partway through (e.g. B2/provider error fetching the
    // signed PDF in handleAttemptCompleted) rolls the transaction back —
    // nothing above was committed. Record it as FAILED on its own (the
    // transaction that would have logged it no longer exists), so it's
    // still visible to Admin and retryable via reconcile (P1-10).
    const message = err instanceof Error ? err.message : String(err);
    console.error("E-sign webhook processing failed:", err);
    await db.esignEvent.create({
      data: {
        provider: providerName,
        providerEventId: idempotencyKey,
        envelopeId: effectiveParsed.envelopeId,
        payload: redactForStorage(effectiveParsed),
        signatureValid,
        processingStatus: "FAILED",
        error: message,
      },
    });
    return { outcome: "FAILED", message };
  }

  const { result, notifications } = outcome;

  for (const n of notifications) {
    await sendOnboardingEmail(n);
  }

  return result;
}

async function processWithinTransaction(
  tx: Prisma.TransactionClient,
  parsed: ParsedWebhookEvent,
  signatureValid: boolean,
  providerName: string,
  providerEventId: string,
  /** Set only by `resolveLeegalityEvent` — pins the exact signer attempt instead of the ambiguous 1:1 `providerEnvelopeId` lookup below. */
  attemptIdHint?: string
): Promise<{ result: ProcessOutcome; notifications: PendingNotification[] }> {
  {
    const pending: PendingNotification[] = [];

    const attempt = attemptIdHint
      ? await tx.esignAttempt.findUnique({
          where: { id: attemptIdHint },
          include: {
            loiVersion: { include: { onboarding: { include: { franchisee: true, salesOwner: true } } } },
          },
        })
      : await tx.esignAttempt.findFirst({
          where: { providerEnvelopeId: parsed.envelopeId },
          include: {
            loiVersion: { include: { onboarding: { include: { franchisee: true, salesOwner: true } } } },
          },
        });

    if (!attempt) {
      await tx.esignEvent.create({
        data: {
          provider: providerName,
          providerEventId,
          envelopeId: parsed.envelopeId,
          payload: redactForStorage(parsed),
          signatureValid,
          processingStatus: "FAILED",
          error: "Unknown envelope — no matching EsignAttempt.",
        },
      });
      return { result: { outcome: "FAILED" as const, message: "Unknown envelope." }, notifications: pending };
    }

    const newerAttemptExists =
      (await tx.esignAttempt.count({
        where: {
          loiVersionId: attempt.loiVersionId,
          signerRole: attempt.signerRole,
          attemptNo: { gt: attempt.attemptNo },
        },
      })) > 0;
    const isVoided = attempt.loiVersion.status === "VOID";
    const alreadyTerminal = TERMINAL_STATUSES.has(attempt.status);

    if (newerAttemptExists || isVoided || alreadyTerminal) {
      await tx.esignEvent.create({
        data: {
          attemptId: attempt.id,
          provider: providerName,
          providerEventId,
          envelopeId: parsed.envelopeId,
          payload: redactForStorage(parsed),
          signatureValid,
          processingStatus: "IGNORED_LATE",
        },
      });
      return { result: { outcome: "IGNORED_LATE" as const }, notifications: pending };
    }

    // Never mark COMPLETED from an unverified payload — the reported hash
    // (when the provider sends one) must match what we actually sent.
    if (parsed.status === "COMPLETED" && parsed.documentSha256 && parsed.documentSha256 !== attempt.pdfSha256) {
      await tx.esignEvent.create({
        data: {
          attemptId: attempt.id,
          provider: providerName,
          providerEventId,
          envelopeId: parsed.envelopeId,
          payload: redactForStorage(parsed),
          signatureValid,
          processingStatus: "FAILED",
          error: "Document hash mismatch.",
        },
      });
      return { result: { outcome: "FAILED" as const, message: "Document hash mismatch." }, notifications: pending };
    }

    const event = ATTEMPT_EVENT_MAP[parsed.status];
    if (event) {
      // Only an *invalid transition* (e.g. duplicate IN_PROGRESS while
      // already IN_PROGRESS) is a harmless no-op — narrowly scoped to this
      // one call so a real failure inside handleAttemptCompleted (B2/
      // provider error while fetching the signed PDF, say) is NOT swallowed
      // here. Letting it propagate rolls back this transaction and is
      // caught at the top level below, which records it as a genuine
      // FAILED event — otherwise it would silently fall through to the
      // "PROCESSED" write further down despite real work having failed
      // (P1-10: a failed callback must be visible to Admin, not hidden).
      let nextAttemptStatus: ReturnType<typeof transitionEsignAttempt> | null = null;
      try {
        nextAttemptStatus = transitionEsignAttempt(attempt.status, event);
      } catch {
        nextAttemptStatus = null;
      }

      if (nextAttemptStatus) {
        await tx.esignAttempt.update({
          where: { id: attempt.id },
          data: {
            status: nextAttemptStatus,
            completedAt: nextAttemptStatus === "COMPLETED" ? new Date() : attempt.completedAt,
          },
        });
        await writeSystemAuditEvent(tx, {
          onboardingId: attempt.loiVersion.onboardingId,
          entityType: "EsignAttempt",
          entityId: attempt.id,
          action: "UPDATE",
          oldValue: { status: attempt.status },
          newValue: { status: nextAttemptStatus },
          reference: `Provider webhook: ${parsed.status}`,
        });

        if (nextAttemptStatus === "COMPLETED") {
          const more = await handleAttemptCompleted(tx, attempt.loiVersion.onboardingId, attempt, providerName);
          pending.push(...more);
        } else if (nextAttemptStatus === "CANCELLED" && providerName === "leegality" && parsed.rejectionMessage) {
          // plan.md section 19 webhook rules: "action = Rejected → attempt
          // CANCELLED, the rejectionMessage becomes LOI feedback".
          const more = await handleAttemptRejected(tx, attempt.loiVersion.onboardingId, attempt, parsed.rejectionMessage);
          pending.push(...more);
        }
      }
    }

    await tx.esignEvent.create({
      data: {
        attemptId: attempt.id,
        provider: providerName,
        providerEventId,
        envelopeId: parsed.envelopeId,
        payload: redactForStorage(parsed),
        signatureValid,
        processingStatus: "PROCESSED",
      },
    });

    return { result: { outcome: "PROCESSED" as const }, notifications: pending };
  }
}

type AttemptWithLoi = Prisma.EsignAttemptGetPayload<{
  include: {
    loiVersion: { include: { onboarding: { include: { franchisee: true; salesOwner: true } } } };
  };
}>;

async function handleAttemptCompleted(
  tx: Prisma.TransactionClient,
  onboardingId: string,
  attempt: AttemptWithLoi,
  providerName: string
): Promise<PendingNotification[]> {
  const loiVersion = attempt.loiVersion;
  const onboarding = loiVersion.onboarding;
  const storeLabel = `${onboarding.brand} ${onboarding.proposedLocation}`;
  const notifications: PendingNotification[] = [];

  if (attempt.signerRole === "FRANCHISEE") {
    const nextLoiStatus = transitionLoiVersion(loiVersion.status, "FRANCHISE_SIGN");
    await tx.loiVersion.update({ where: { id: loiVersion.id }, data: { status: nextLoiStatus } });
    await writeSystemAuditEvent(tx, {
      onboardingId,
      entityType: "LoiVersion",
      entityId: loiVersion.id,
      action: "UPDATE",
      oldValue: { status: loiVersion.status },
      newValue: { status: nextLoiStatus },
      reference: "Franchisee e-sign completed",
    });
    await recomputeOnboardingStatus(tx, onboardingId);

    // plan.md section 19 L5, edge case 2: back up what Leegality holds right
    // now, while it still exists — the shared document can later be voided
    // (a new version, or a restart after the company's link expires), and
    // the franchisee's half-signed copy would otherwise be unrecoverable.
    // Same discipline as the COMPANY branch below: a real failure here
    // (B2/provider error) rolls the transaction back and surfaces as a
    // genuine FAILED event (P1-10), rather than being swallowed.
    if (providerName === "leegality" && !loiVersion.franchiseeSignedPdfB2Key) {
      const provider = getEsignProvider();
      const key = `onboarding/${onboardingId}/loi/${loiVersion.versionNo}/franchisee-signed.pdf`;
      const bytes = await provider.fetchSignedPdf(attempt.providerEnvelopeId!);
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await uploadDocument({ key, body: bytes, contentType: "application/pdf" });
      await tx.loiVersion.update({
        where: { id: loiVersion.id },
        data: { franchiseeSignedPdfB2Key: key, franchiseeSignedPdfSha256: sha256 },
      });
    }

    const signatories = await tx.user.findMany({ where: { role: "COMPANY_SIGNATORY", isActive: true } });
    for (const s of signatories) {
      if (!s.email) continue;
      notifications.push({ key: "franchise_signed", to: s.email, onboardingId, vars: { name: s.name, store: storeLabel } });
    }
    return notifications;
  }

  // COMPANY
  const nextLoiStatus = transitionLoiVersion(loiVersion.status, "COMPANY_SIGN");

  let signedPdfB2Key = loiVersion.signedPdfB2Key;
  let signedPdfSha256 = loiVersion.signedPdfSha256;
  let certificateB2Key = loiVersion.certificateB2Key;

  // Never overwrite an existing signed copy (P1-08 / section 17's own rule).
  if (!signedPdfB2Key) {
    signedPdfB2Key = `onboarding/${onboardingId}/loi/${loiVersion.versionNo}/signed.pdf`;
    certificateB2Key = `onboarding/${onboardingId}/loi/${loiVersion.versionNo}/certificate.pdf`;

    const provider = getEsignProvider();
    const signedPdf = await provider.fetchSignedPdf(attempt.providerEnvelopeId!);
    const certificate = await provider.fetchCertificate(attempt.providerEnvelopeId!);
    const { createHash } = await import("node:crypto");
    signedPdfSha256 = createHash("sha256").update(signedPdf).digest("hex");
    await uploadDocument({ key: signedPdfB2Key, body: signedPdf, contentType: "application/pdf" });
    await uploadDocument({ key: certificateB2Key, body: certificate, contentType: "application/pdf" });
  }

  await tx.loiVersion.update({
    where: { id: loiVersion.id },
    data: { status: nextLoiStatus, signedPdfB2Key, signedPdfSha256, certificateB2Key },
  });
  await writeSystemAuditEvent(tx, {
    onboardingId,
    entityType: "LoiVersion",
    entityId: loiVersion.id,
    action: "UPDATE",
    oldValue: { status: loiVersion.status },
    newValue: { status: nextLoiStatus, signedPdfSha256 },
    reference: "Company e-sign completed",
  });
  await recomputeOnboardingStatus(tx, onboardingId);

  if (onboarding.franchisee.email) {
    notifications.push({
      key: "company_signed",
      to: onboarding.franchisee.email,
      onboardingId,
      vars: { name: onboarding.franchisee.name, store: storeLabel },
    });
  }

  // Both signers complete — convert to FranchiseProject now (idempotent,
  // skip if already converted; see conversion.ts).
  const conversion = await convertOnboardingToProject(tx, onboardingId);
  if (conversion.converted) {
    const link = `${process.env.APP_URL || "http://localhost:3000"}/projects/${conversion.projectId}`;
    if (conversion.franchiseeEmail) {
      notifications.push({
        key: "loi_complete",
        to: conversion.franchiseeEmail,
        onboardingId,
        vars: { name: conversion.franchiseeName, store: conversion.storeLabel, link },
      });
    }
    // Mirrors the FRANCHISEE branch's signatories loop above (lines ~289-293)
    // — the franchisee isn't the only one who needs to know the project now
    // exists; the sales owner is the internal staff tied to this onboarding
    // and otherwise has no way to discover the FranchiseProject was created.
    if (onboarding.salesOwner.email) {
      notifications.push({
        key: "loi_complete",
        to: onboarding.salesOwner.email,
        onboardingId,
        vars: { name: onboarding.salesOwner.name, store: conversion.storeLabel, link },
      });
    }
  }

  return notifications;
}

/**
 * plan.md section 19 webhook rules: a rejection on Leegality becomes LOI
 * feedback, the same channel `submitLoiFeedback` (loi/actions.ts) uses for a
 * franchisee typing a note before signing — preparer + sales owner + Admin
 * backstop, logged as a system-actor audit event since there's no
 * signed-in user behind a webhook.
 */
async function handleAttemptRejected(
  tx: Prisma.TransactionClient,
  onboardingId: string,
  attempt: AttemptWithLoi,
  rejectionMessage: string
): Promise<PendingNotification[]> {
  const onboarding = attempt.loiVersion.onboarding;
  const storeLabel = `${onboarding.brand} ${onboarding.proposedLocation}`;
  const whoRejected = attempt.signerRole === "FRANCHISEE" ? "the franchisee" : "the company signatory";
  const message = `[Rejected during Leegality e-sign by ${whoRejected}] ${rejectionMessage}`;

  await writeSystemAuditEvent(tx, {
    onboardingId,
    entityType: "LoiFeedback",
    entityId: onboardingId,
    action: "CREATE",
    newValue: { message, signerRole: attempt.signerRole },
    reference: "Signer rejected on Leegality — recorded as LOI feedback",
  });

  const loiPreparers = await tx.user.findMany({ where: { role: "LOI_PREPARER", isActive: true } });
  const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true } });
  const recipients = new Map<string, { name: string; email: string }>();
  for (const u of [onboarding.salesOwner, ...loiPreparers, ...admins]) {
    if (u.email) recipients.set(u.email, { name: u.name, email: u.email });
  }

  const link = `${process.env.APP_URL || "http://localhost:3000"}/store-onboarding/${onboardingId}`;
  return Array.from(recipients.values()).map((r) => ({
    key: "loi_feedback" as const,
    to: r.email,
    onboardingId,
    vars: { name: r.name, franchiseeName: onboarding.franchisee.name, store: storeLabel, message, link },
  }));
}
