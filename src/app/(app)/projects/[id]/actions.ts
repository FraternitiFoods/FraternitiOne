"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  canActOnTask,
  canForceCompleteStage,
  canManageTaskModule,
  canViewProject,
} from "@/lib/permissions";
import { Department, LifecycleStage, TaskPriority, TaskStatus } from "@prisma/client";

export type ActionState = { error?: string } | undefined;

async function loadProjectOrThrow(projectId: string) {
  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  return project;
}

const CreateTaskSchema = z.object({
  module: z.nativeEnum(Department),
  lifecycleStage: z.nativeEnum(LifecycleStage),
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().optional(),
  ownerId: z.string().min(1, "Owner is required."),
  dueDate: z.string().optional(),
  priority: z.nativeEnum(TaskPriority),
  dependsOnId: z.string().optional(),
});

export async function createTask(
  projectId: string,
  redirectTo: string,
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
    lifecycleStage: formData.get("lifecycleStage"),
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
    const lastInStage = await tx.task.findFirst({
      where: { projectId, lifecycleStage: data.lifecycleStage },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const task = await tx.task.create({
      data: {
        projectId,
        module: data.module,
        lifecycleStage: data.lifecycleStage,
        title: data.title,
        order: (lastInStage?.order ?? -1) + 1,
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
        lifecycleStage: task.lifecycleStage,
        title: task.title,
        ownerId: task.ownerId,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null,
      },
    });
  });

  redirect(redirectTo);
}

const UpdateTaskStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  completionEvidence: z.string().trim().optional(),
});

export async function updateTaskStatus(
  taskId: string,
  projectId: string,
  redirectTo: string,
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

  redirect(redirectTo);
}

const AddCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty."),
});

export async function addTaskComment(
  taskId: string,
  projectId: string,
  redirectTo: string,
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

  redirect(redirectTo);
}

const UpdateTaskTitleSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
});

export async function updateTaskTitle(
  taskId: string,
  projectId: string,
  redirectTo: string,
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

  const parsed = UpdateTaskTitleSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { title: parsed.data.title },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Task",
      entityId: task.id,
      action: "UPDATE",
      oldValue: { title: task.title },
      newValue: { title: updated.title },
    });
  });

  redirect(redirectTo);
}

export async function moveTask(
  taskId: string,
  projectId: string,
  direction: "up" | "down",
  redirectTo: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);
  const task = await db.task.findUnique({ where: { id: taskId } });

  if (!task || task.projectId !== projectId || !canViewProject(user, project)) {
    return { error: "Task not found." };
  }
  if (!canActOnTask(user, task, project)) {
    return { error: "You don't have permission to reorder this task." };
  }

  const neighbor = await db.task.findFirst({
    where: {
      projectId,
      lifecycleStage: task.lifecycleStage,
      order: direction === "up" ? { lt: task.order } : { gt: task.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });

  if (!neighbor) {
    return undefined;
  }

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { order: neighbor.order } });
    await tx.task.update({ where: { id: neighbor.id }, data: { order: task.order } });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "Task",
      entityId: task.id,
      action: "UPDATE",
      oldValue: { order: task.order },
      newValue: { order: neighbor.order },
      reference: `Swapped with "${neighbor.title}"`,
    });
  });

  redirect(redirectTo);
}

export async function forceCompleteStage(
  projectId: string,
  stage: LifecycleStage,
  redirectTo: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);

  if (!canViewProject(user, project)) {
    return { error: "Project not found." };
  }
  if (!canForceCompleteStage(user)) {
    return { error: "You don't have permission to force-complete a stage." };
  }

  await db.$transaction(async (tx) => {
    const override = await tx.projectStageOverride.upsert({
      where: { projectId_stage: { projectId, stage } },
      create: { projectId, stage, completedById: user.id },
      update: {},
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "ProjectStageOverride",
      entityId: override.id,
      action: "CREATE",
      newValue: { stage },
    });
  });

  redirect(redirectTo);
}

export async function revertStageOverride(
  projectId: string,
  stage: LifecycleStage,
  redirectTo: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const project = await loadProjectOrThrow(projectId);

  if (!canViewProject(user, project)) {
    return { error: "Project not found." };
  }
  if (!canForceCompleteStage(user)) {
    return { error: "You don't have permission to reopen a stage." };
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.projectStageOverride.findUnique({
      where: { projectId_stage: { projectId, stage } },
    });
    if (!existing) return;

    await tx.projectStageOverride.delete({ where: { id: existing.id } });

    await writeAuditEvent(tx, {
      actor: user,
      projectId,
      entityType: "ProjectStageOverride",
      entityId: existing.id,
      action: "DELETE",
      oldValue: { stage },
    });
  });

  redirect(redirectTo);
}
