import "server-only";

import type { Prisma, AuditAction } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";

type AuditWriter = Pick<Prisma.TransactionClient, "auditEvent"> | typeof import("@/lib/db").db;

export type AuditEventInput = {
  actor: CurrentUser;
  projectId?: string | null;
  /// plan.md section 17: set for anything that happened while a store was
  /// still an onboarding record, before its FranchiseProject existed. Callers
  /// should set exactly one of projectId/onboardingId in practice, but the
  /// column itself only requires "at least one" (app-level, not DB-level —
  /// Prisma has no declarative check for that).
  onboardingId?: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reference?: string | null;
  source?: string;
};

/**
 * Writes one AuditEvent (FR-010: "Full audit log for critical changes and
 * approvals. Must: Actor, timestamp, old/new value and reference stored.").
 *
 * Every create/update/delete on Task, Document, or Project MUST go through
 * this — plan.md section 4 calls this out explicitly as a cause -> effect
 * that must hold, not an optional add-on. Callers should pass a
 * `Prisma.TransactionClient` (via `db.$transaction`) so the entity mutation
 * and its audit record commit or fail together; a bare `db` client works
 * too but loses that atomicity guarantee.
 */
export async function writeAuditEvent(
  client: AuditWriter,
  input: AuditEventInput
) {
  // Note: NOT enforcing "projectId or onboardingId required" here — plenty of
  // pre-existing call sites (User CREATE/UPDATE/LOGIN/LOGOUT, ProjectMember)
  // legitimately have neither and predate section 17. The "require at least
  // one" instruction in plan.md section 17 applies to onboarding-scoped
  // entities (KycSubmission, PaymentSubmission, LoiVersion, EsignAttempt,
  // StoreOnboarding, OnboardingFile) — call sites for those pass
  // onboardingId; enforcing it table-wide would break existing behavior.
  const { actor, ...rest } = input;
  return client.auditEvent.create({
    data: {
      projectId: rest.projectId ?? null,
      onboardingId: rest.onboardingId ?? null,
      actorId: actor.id,
      // AuditEvent.actorEmail is a required denormalized snapshot (NFR-06 —
      // immutable even if the User row later changes). A phone-only
      // SITE_SUPERVISOR (plan.md section 16) has no email, so fall back to an
      // explicit placeholder rather than writing an empty string.
      actorEmail: actor.email ?? "(no email on file)",
      actorName: actor.name,
      actorRole: actor.role,
      entityType: rest.entityType,
      entityId: rest.entityId,
      action: rest.action,
      oldValue: rest.oldValue ?? undefined,
      newValue: rest.newValue ?? undefined,
      reference: rest.reference ?? null,
      source: rest.source ?? "web",
    },
  });
}
