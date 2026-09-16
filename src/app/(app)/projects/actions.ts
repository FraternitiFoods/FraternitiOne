"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateProject, canEditProjectHeader, canViewProject } from "@/lib/permissions";
import { LifecycleStage, ProjectHealth } from "@prisma/client";

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
    const created = await tx.franchiseProject.create({
      data: {
        brand: data.brand,
        format: data.format,
        location: data.location,
        franchiseeId: data.franchiseeId,
        ownerId: data.ownerId,
        targetOpening,
        nextAction: data.nextAction || null,
        // FR-001: every project starts at the same first lifecycle stage —
        // not exposed as a create-time input (Wireframe 01 implementation
        // note: "Current stage ... must be computed, not manually typed").
        lifecycleStage: LifecycleStage.SALES_LOI,
        health: ProjectHealth.GREEN,
      },
    });

    await writeAuditEvent(tx, {
      actor: user,
      projectId: created.id,
      entityType: "FranchiseProject",
      entityId: created.id,
      action: "CREATE",
      newValue: {
        brand: created.brand,
        format: created.format,
        location: created.location,
        franchiseeId: created.franchiseeId,
        ownerId: created.ownerId,
        targetOpening: created.targetOpening.toISOString(),
        lifecycleStage: created.lifecycleStage,
      },
    });

    return created;
  });

  redirect(`/projects/${project.id}`);
}

const UpdateHeaderSchema = z.object({
  lifecycleStage: z.nativeEnum(LifecycleStage),
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
    lifecycleStage: formData.get("lifecycleStage"),
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
        lifecycleStage: data.lifecycleStage,
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
        lifecycleStage: project.lifecycleStage,
        health: project.health,
        nextAction: project.nextAction,
        targetOpening: project.targetOpening.toISOString(),
      },
      newValue: {
        lifecycleStage: updated.lifecycleStage,
        health: updated.health,
        nextAction: updated.nextAction,
        targetOpening: updated.targetOpening.toISOString(),
      },
    });
  });

  redirect(`/projects/${projectId}`);
}
