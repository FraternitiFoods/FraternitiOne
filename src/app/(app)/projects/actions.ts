"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";
import { canCreateProject, canDeleteProject, canEditProjectHeader, canViewProject } from "@/lib/permissions";
import { ProjectHealth, type Department, type LifecycleStage } from "@prisma/client";
import { LIFECYCLE_STAGE_ORDER } from "@/lib/format";
import { STAGE_DEFAULT_DEPARTMENT, STAGE_TASK_TEMPLATES } from "@/lib/lifecycle-stage-tasks";
import { OPS_PROGRESS_TASK_TEMPLATES } from "@/lib/ops-progress-tasks";

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
      },
    });

    // Every project starts with the full lifecycle checklist pre-seeded
    // (franchise lifecycle tracker sheet) — the project's Owner is the
    // default task owner since there's no per-department roster yet — plus
    // the BOQ/Ops master checklist (plan.md section 9, 2026-09-21), tagged
    // with `category` (the trade/dept roll-up axis) on top of the same
    // `module`/`lifecycleStage` fields. Ops items continue each stage's
    // `order` sequence after its checklist items, same "ad-hoc appends to
    // the end" convention as manually-added tasks.
    type SeedTaskInput = {
      module: Department;
      category: string | null;
      lifecycleStage: LifecycleStage;
      order: number;
      title: string;
    };

    const seedTasks: SeedTaskInput[] = [];
    const nextOrderByStage = new Map<LifecycleStage, number>();
    for (const stage of LIFECYCLE_STAGE_ORDER) {
      STAGE_TASK_TEMPLATES[stage].forEach((title, order) => {
        seedTasks.push({
          module: STAGE_DEFAULT_DEPARTMENT[stage],
          category: null,
          lifecycleStage: stage,
          order,
          title,
        });
      });
      nextOrderByStage.set(stage, STAGE_TASK_TEMPLATES[stage].length);
    }
    for (const item of OPS_PROGRESS_TASK_TEMPLATES) {
      const order = nextOrderByStage.get(item.lifecycleStage) ?? 0;
      nextOrderByStage.set(item.lifecycleStage, order + 1);
      seedTasks.push({
        module: item.module,
        category: item.category,
        lifecycleStage: item.lifecycleStage,
        order,
        title: item.title,
      });
    }

    // ~720 tasks/site (158 checklist + 566 BOQ/Ops) — a per-row create +
    // per-row writeAuditEvent loop here means ~1,450 sequential round trips
    // inside one interactive transaction, comfortably over Prisma's default
    // 5s transaction timeout. createManyAndReturn/createMany cut that to 2
    // round trips; the AuditEvent shape below mirrors writeAuditEvent's
    // exactly (still one CREATE event per Task, per plan.md section 4 — not
    // optional), just issued in bulk instead of through that helper.
    const createdTasks = await tx.task.createManyAndReturn({
      data: seedTasks.map((t) => ({
        projectId: created.id,
        module: t.module,
        category: t.category,
        lifecycleStage: t.lifecycleStage,
        order: t.order,
        title: t.title,
        ownerId: created.ownerId,
        createdById: user.id,
      })),
    });

    await tx.auditEvent.createMany({
      data: createdTasks.map((task) => ({
        projectId: created.id,
        actorId: user.id,
        actorEmail: user.email ?? "(no email on file)",
        actorName: user.name,
        actorRole: user.role,
        entityType: "Task",
        entityId: task.id,
        action: "CREATE" as const,
        newValue: {
          module: task.module,
          category: task.category,
          lifecycleStage: task.lifecycleStage,
          title: task.title,
          ownerId: task.ownerId,
          status: task.status,
        },
        reference: "Auto-seeded from lifecycle checklist",
        source: "web",
      })),
    });

    return created;
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
