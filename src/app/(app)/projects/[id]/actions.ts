"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canActOnTask, canManageTaskModule, canViewProject } from "@/lib/permissions";
import { Department, TaskPriority, TaskStatus } from "@prisma/client";

export type ActionState = { error?: string } | undefined;

async function loadProjectOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  return project;
}

const CreateTaskSchema = z.object({
  module: z.nativeEnum(Department),
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().optional(),
  ownerId: z.string().min(1, "Owner is required."),
  dueDate: z.string().optional(),
  priority: z.nativeEnum(TaskPriority),
  dependsOnId: z.string().optional(),
});

export async function createTask(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);

  if (!canViewProject(user, project)) {
    return { error: "Project not found." };
  }

  const parsed = CreateTaskSchema.safeParse({
    module: formData.get("module"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    ownerId: formData.get("ownerId"),
    dueDate: formData.get("dueDate") || undefined,
    priority: formData.get("priority"),
    dependsOnId: formData.get("dependsOnId") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  if (!canManageTaskModule(user, data.module)) {
    return { error: "You don't have permission to create tasks in that module." };
  }

  const dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.dueDate && dueDate && Number.isNaN(dueDate.getTime())) {
    return { error: "Due date is invalid." };
  }

  await db.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        projectId,
        module: data.module,
        title: data.title,
        description: data.description || null,
        ownerId: data.ownerId,
        createdById: user.id,
        dueDate,
        priority: data.priority,
        dependsOnId: data.dependsOnId || null,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Task",
      entityId: task.id,
      action: "CREATE",
      newValue: {
        module: task.module,
        title: task.title,
        ownerId: task.ownerId,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null,
      },
    });
  });

  redirect(`/projects/${projectId}`);
}

const UpdateTaskStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  completionEvidence: z.string().trim().optional(),
});

export async function updateTaskStatus(
  taskId: string,
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const task = await db.task.findUnique({ where: { id: taskId } });

  if (!task || task.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Task not found." };
  }
  if (!canActOnTask(user, task, project)) {
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
  const isCompleting = status === TaskStatus.COMPLETED;

  await db.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: isCompleting ? new Date() : null,
        completionEvidence: isCompleting ? completionEvidence || task.completionEvidence : task.completionEvidence,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Task",
      entityId: task.id,
      action: "UPDATE",
      oldValue: { status: task.status, completionEvidence: task.completionEvidence },
      newValue: { status: updated.status, completionEvidence: updated.completionEvidence },
    });
  });

  redirect(`/projects/${projectId}`);
}

const AddCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty."),
});

export async function addTaskComment(
  taskId: string,
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const task = await db.task.findUnique({ where: { id: taskId } });

  if (!task || task.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Task not found." };
  }

  const parsed = AddCommentSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Comments are a lightweight sub-record of a Task, not the Task itself —
  // plan.md section 4's audit mandate names Task/Document/Project explicitly.
  // Not writing an AuditEvent per comment keeps the audit log signal-heavy;
  // task status/field changes are still fully audited above.
  await db.taskComment.create({
    data: { taskId, authorId: user.id, body: parsed.data.body },
  });

  redirect(`/projects/${projectId}`);
}
