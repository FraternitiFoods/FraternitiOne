import "server-only";

import type { Prisma, Task, TaskStatus } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";

/**
 * plan.md section 24 (delay tracking, proposed 2026-10-08), rule #2: "Every
 * status change goes through the one helper, and every change writes an
 * AuditEvent (old -> new). No second code path may set COMPLETED." This is
 * that one helper — every place that changes `Task.status` must call it
 * instead of writing `tx.task.update({ data: { status, ... } })` directly.
 *
 * Behavior mirrors exactly what the two pre-existing call sites already did
 * before this helper existed (see updateTaskStatus in
 * src/app/(app)/projects/[id]/actions.ts and finalizeUpload in
 * src/app/m/[id]/actions.ts), plus the one new fact section 24 needs:
 * `startedAt`, set once, the first time a task leaves NOT_STARTED.
 *
 * Evidence-on-completion rule (2026-10-17): completing a task requires some
 * form of proof — new/existing `completionEvidence` text (a note or a pasted
 * link), or at least one `Document` already attached to the task (the `/m`
 * upload flow always creates that Document in the same transaction right
 * before calling this, so it's never actually blocked). Throws if neither is
 * present; callers should catch and surface it as a normal `{ error }`.
 */
export async function applyTaskStatusChange(
  tx: Prisma.TransactionClient,
  task: Pick<Task, "id" | "status" | "startedAt" | "completionEvidence">,
  newStatus: TaskStatus,
  actor: CurrentUser,
  opts?: {
    /** Only applied when `newStatus` is COMPLETED; otherwise the task's existing evidence is kept. */
    completionEvidence?: string | null;
    reference?: string | null;
    source?: string;
    projectId?: string | null;
  }
): Promise<Task> {
  const isCompleting = newStatus === "COMPLETED";
  const startsNow = task.status === "NOT_STARTED" && newStatus !== "NOT_STARTED" && !task.startedAt;

  if (isCompleting) {
    const hasTextEvidence = Boolean(opts?.completionEvidence?.trim() || task.completionEvidence?.trim());
    if (!hasTextEvidence) {
      const attachedDocs = await tx.document.count({ where: { taskId: task.id } });
      if (attachedDocs === 0) {
        throw new Error(
          "Add completion evidence (a note, link, or attached document) before marking this task completed."
        );
      }
    }
  }

  const updated = await tx.task.update({
    where: { id: task.id },
    data: {
      status: newStatus,
      startedAt: startsNow ? new Date() : task.startedAt,
      completedAt: isCompleting ? new Date() : null,
      completionEvidence: isCompleting
        ? opts?.completionEvidence || task.completionEvidence
        : task.completionEvidence,
    },
  });

  await writeAuditEvent(tx, {
    actor,
    projectId: opts?.projectId,
    entityType: "Task",
    entityId: task.id,
    action: "UPDATE",
    oldValue: { status: task.status, completionEvidence: task.completionEvidence },
    newValue: { status: updated.status, completionEvidence: updated.completionEvidence },
    reference: opts?.reference,
    source: opts?.source,
  });

  return updated;
}
