import "server-only";

import type { Prisma, AuditAction } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";

type AuditWriter = Pick<Prisma.TransactionClient, "auditEvent"> | typeof import("@/lib/db").db;

export type AuditEventInput = {
  actor: CurrentUser;
  projectId?: string | null;
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
  const { actor, ...rest } = input;
  return client.auditEvent.create({
    data: {
      projectId: rest.projectId ?? null,
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
