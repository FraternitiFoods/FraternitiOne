"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateProject, canDeleteProject, canEditProjectHeader, canViewProject } from "@/lib/permissions";
import { ProjectHealth } from "@prisma/client";
import { createProjectWithSeedTasks } from "@/lib/project-seed";

const CreateProjectSchema = z.object({
  brand: z.string().trim().min(1).default("Tulsi"),
  format: z.string().trim().min(1, "Format is required."),
  location: z.string().trim().min(1, "Location is required."),
  franchiseeId: z.string().min(1, "Franchisee is required."),
  ownerId: z.string().min(1, "Owner is required."),
  targetOpening: z.string().min(1, "Target opening date is required."),
  nextAction: z.string().trim().optional(),
});

export type ActionState = { error?: string } | undefined;

export async function createProject(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();

  if (!canCreateProject(user)) {
    return { error: "You don't have permission to create a franchise project." };
  }

  const parsed = CreateProjectSchema.safeParse({
    brand: formData.get("brand") || undefined,
    format: formData.get("format"),
    location: formData.get("location"),
    franchiseeId: formData.get("franchiseeId"),
    ownerId: formData.get("ownerId"),
    targetOpening: formData.get("targetOpening"),
    nextAction: formData.get("nextAction") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const targetOpening = new Date(data.targetOpening);
  if (Number.isNaN(targetOpening.getTime())) {
    return { error: "Target opening date is invalid." };
  }

  const project = await db.$transaction(async (tx) => {
    return createProjectWithSeedTasks(tx, {
      brand: data.brand,
      format: data.format,
      location: data.location,
      franchiseeId: data.franchiseeId,
      ownerId: data.ownerId,
      targetOpening,
      nextAction: data.nextAction,
      health: ProjectHealth.GREEN,
      actor: user,
    });
  });

  redirect(`/projects/${project.id}`);
}

const UpdateHeaderSchema = z.object({
  health: z.nativeEnum(ProjectHealth),
  nextAction: z.string().trim().optional(),
  targetOpening: z.string().min(1),
});

export async function updateProjectHeader(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();

  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project || !canViewProject(user, project)) {
    return { error: "Project not found." };
  }
  if (!canEditProjectHeader(user)) {
    return { error: "You don't have permission to update this project." };
  }

  const parsed = UpdateHeaderSchema.safeParse({
    health: formData.get("health"),
    nextAction: formData.get("nextAction") || undefined,
    targetOpening: formData.get("targetOpening"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const targetOpening = new Date(data.targetOpening);
  if (Number.isNaN(targetOpening.getTime())) {
    return { error: "Target opening date is invalid." };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.franchiseProject.update({
      where: { id: projectId },
      data: {
        health: data.health,
        nextAction: data.nextAction || null,
        targetOpening,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId: updated.id,
      entityType: "FranchiseProject",
      entityId: updated.id,
      action: "UPDATE",
      oldValue: {
        health: project.health,
        nextAction: project.nextAction,
        targetOpening: project.targetOpening.toISOString(),
      },
      newValue: {
        health: updated.health,
        nextAction: updated.nextAction,
        targetOpening: updated.targetOpening.toISOString(),
      },
    });
  });

  redirect(`/projects/${projectId}`);
}

export type DeleteProjectState = { error?: string } | undefined;

/**
 * Hard delete — every child row (Task, TaskComment, Document,
 * ProjectStageOverride) cascades via the FK's `onDelete: Cascade` (see
 * schema.prisma); AuditEvent.projectId is `onDelete: SetNull` instead, so the
 * audit trail (including this DELETE event's own oldValue snapshot) survives
 * the project itself being gone. Confirmation lives in the client
 * (DeleteProjectButton's dialog) — deliberately a plain "are you sure",
 * not a type-the-name gate: this mirrors deleteUser's existing pattern
 * rather than inventing a heavier one.
 */
export async function deleteProject(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: DeleteProjectState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<DeleteProjectState> {
  const user = await requireUser();

  if (!canDeleteProject(user)) {
    return { error: "You don't have permission to delete this project." };
  }

  const project = await db.franchiseProject.findUnique({ where: { id: projectId } });
  if (!project) {
    return { error: "Project not found." };
  }

  await db.$transaction(async (tx) => {
    await writeAuditEvent(tx, {
      actor: user,
      projectId: project.id,
      entityType: "FranchiseProject",
      entityId: project.id,
      action: "DELETE",
      oldValue: {
        brand: project.brand,
        format: project.format,
        location: project.location,
        franchiseeId: project.franchiseeId,
        ownerId: project.ownerId,
        health: project.health,
      },
      reference: "Deleted via project admin controls",
    });
    await tx.franchiseProject.delete({ where: { id: projectId } });
  });

  redirect("/dashboard");
}
