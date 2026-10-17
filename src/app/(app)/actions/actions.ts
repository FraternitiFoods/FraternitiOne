"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canActOnTask } from "@/lib/permissions";
import { applyTaskStatusChange } from "@/lib/task-status";
import { TaskStatus } from "@prisma/client";

export type ActionState = { error?: string } | undefined;

const UpdateTaskStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  completionEvidence: z.string().trim().optional(),
});

/**
 * Action Centre's own status-change action — same permission check and same
 * `applyTaskStatusChange` helper as `updateTaskStatus`
 * (projects/[id]/actions.ts), but `revalidatePath` instead of a hard
 * `redirect`, since the point of this one is staying on /actions rather than
 * bouncing out to the stage page for a fast status change.
 */
export async function updateTaskStatusFromActions(
  taskId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { franchiseeId: true } } },
  });
  if (!task) {
    return { error: "Task not found." };
  }
  if (!canActOnTask(user, task, task.project)) {
    return { error: "You don't have permission to update this task." };
  }

  const parsed = UpdateTaskStatusSchema.safeParse({
    status: formData.get("status"),
    completionEvidence: formData.get("completionEvidence") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { status, completionEvidence } = parsed.data;

  await db.$transaction(async (tx) => {
    await applyTaskStatusChange(tx, task, status, user, {
      completionEvidence,
      projectId: task.projectId,
    });
  });

  revalidatePath("/actions");
  return undefined;
}
