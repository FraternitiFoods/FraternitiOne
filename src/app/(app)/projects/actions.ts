"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  canCreateProject,
  canDeleteProject,
  canEditProjectHeader,
  canReclassifyProject,
  canViewProject,
} from "@/lib/permissions";
import { ProjectHealth } from "@prisma/client";
import { createProjectWithSeedTasks, seedLifecycleAndOpsTasks } from "@/lib/project-seed";

const CreateProjectSchema = z.object({
  brand: z.string().trim().min(1).default("Tulsi"),
  format: z.string().trim().min(1, "Format is required."),
  location: z.string().trim().min(1, "Location is required."),
  franchiseeId: z.string().min(1, "Franchisee is required."),
  ownerId: z.string().min(1, "Owner is required."),
  targetOpening: z.string().min(1, "Target opening date is required."),
  nextAction: z.string().trim().optional(),
  skipSeeding: z.boolean().optional(),
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
    skipSeeding: formData.get("skipSeeding") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const targetOpening = new Date(data.targetOpening);
  if (Number.isNaN(targetOpening.getTime())) {
    return { error: "Target opening date is invalid." };
  }

  const project = await db.$transaction(
    async (tx) => {
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
        seedTasks: !data.skipSeeding,
      });
    },
    // Prisma's default interactive-transaction timeout (5000ms) is too tight
    // in production: seeding the ~963 lifecycle tasks + their audit trail
    // measured 5.2-5.5s there (see project-seed.ts), closing the transaction
    // mid-write and 500ing every project creation (P2028).
    { timeout: 20000 }
  );

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

export type ReclassifyProjectState = { error?: string } | undefined;

/**
 * Flips `FranchiseProject.isPreExisting` — plan.md section 23 left this
 * settable only at creation time; this closes that gap. Toggles whatever the
 * current value is (no form field needed beyond the project id), so the UI
 * is a single button whose label/dialog copy already tells the admin which
 * direction they're about to flip.
 *
 * Marking a build-out project "already operational" never touches its
 * existing Task rows — deleting them isn't this action's call to make (plan.md
 * section 23's own NOT DECIDED #2); the project just stops showing them to the
 * franchisee. Marking a pre-existing project back to a normal build-out seeds
 * the standard checklist, but only if it currently has zero tasks — a project
 * that already picked up tasks some other way (e.g. an ad-hoc admin add)
 * never gets double-seeded.
 */
export async function reclassifyProject(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ReclassifyProjectState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<ReclassifyProjectState> {
  const user = await requireUser();

  if (!canReclassifyProject(user)) {
    return { error: "You don't have permission to reclassify this project." };
  }

  const project = await db.franchiseProject.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, isPreExisting: true, _count: { select: { tasks: true } } },
  });
  if (!project) {
    return { error: "Project not found." };
  }

  const nextIsPreExisting = !project.isPreExisting;
  const willSeedTasks = !nextIsPreExisting && project._count.tasks === 0;

  await db.$transaction(
    async (tx) => {
      await tx.franchiseProject.update({
        where: { id: projectId },
        data: { isPreExisting: nextIsPreExisting },
      });

      await writeAuditEvent(tx, {
        actor: user,
        projectId,
        entityType: "FranchiseProject",
        entityId: projectId,
        action: "UPDATE",
        oldValue: { isPreExisting: project.isPreExisting },
        newValue: { isPreExisting: nextIsPreExisting },
        reference: willSeedTasks
          ? "Reclassified via project admin controls; build-out checklist seeded"
          : "Reclassified via project admin controls",
      });

      if (willSeedTasks) {
        await seedLifecycleAndOpsTasks(tx, { id: project.id, ownerId: project.ownerId }, user);
      }
    },
    // Seeding ~963 tasks measured 5.2-5.5s against production (section 27A) —
    // over Prisma's default 5s timeout. Only needed when willSeedTasks, but a
    // fixed timeout is simpler than branching the $transaction call shape.
    { timeout: 20000 }
  );

  redirect(`/projects/${projectId}`);
}
