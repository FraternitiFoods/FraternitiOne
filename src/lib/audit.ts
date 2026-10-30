import "server-only";

import type { Prisma, AuditAction } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";

type AuditWriter = Pick<Prisma.TransactionClient, "auditEvent"> | typeof import("@/lib/db").db;

export type AuditEventInput = {
  actor: CurrentUser;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reference?: string | null;
  source?: string;
};

/**
 * Writes one AuditEvent. Every create/update/delete on User, and every
 * login/logout, goes through this.
 *
 * Callers should pass a `Prisma.TransactionClient` (via `db.$transaction`) so
 * the entity mutation and its audit record commit or fail together; a bare
 * `db` client works too but loses that atomicity guarantee.
 */
export async function writeAuditEvent(
  client: AuditWriter,
  input: AuditEventInput
) {
  const { actor, ...rest } = input;
  return client.auditEvent.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
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
