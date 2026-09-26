import "server-only";

import type { Prisma, Department, LifecycleStage, ProjectHealth, Role } from "@prisma/client";
import { LIFECYCLE_STAGE_ORDER } from "@/lib/format";
import { STAGE_DEFAULT_DEPARTMENT, STAGE_TASK_TEMPLATES } from "@/lib/lifecycle-stage-tasks";
import { OPS_PROGRESS_TASK_TEMPLATES } from "@/lib/ops-progress-tasks";

/**
 * Extracted from the createProject Server Action (src/app/(app)/projects/
 * actions.ts) so plan.md section 17's onboarding-conversion path (see
 * src/lib/onboarding/conversion.ts) can create a FranchiseProject the exact
 * same way — same seeded ~963 tasks, same audit trail shape — without
 * reimplementing task seeding (build-order step 7's own instruction).
 * `createProject` itself now calls this too, so there is exactly one place
 * that knows how a project gets seeded.
 */
export async function createProjectWithSeedTasks(
  tx: Prisma.TransactionClient,
  params: {
    /** Explicit id (e.g. a reserved onboarding Project ID) — omitted lets Prisma's @default(cuid()) generate one. */
    id?: string;
    brand: string;
    format: string;
    location: string;
    franchiseeId: string;
    ownerId: string;
    targetOpening: Date;
    nextAction?: string | null;
    health?: ProjectHealth;
    /**
     * Task.createdById is a required (non-null) FK, so this always needs a
     * real User id — the onboarding-conversion caller (which has no
     * signed-in user; it runs from a webhook) passes the onboarding's sales
     * owner as a stand-in "actor" for exactly this reason (see
     * conversion.ts).
     */
    actor: { id: string; name: string; email: string | null; role: Role };
  }
) {
  const created = await tx.franchiseProject.create({
    data: {
      id: params.id,
      brand: params.brand,
      format: params.format,
      location: params.location,
      franchiseeId: params.franchiseeId,
      ownerId: params.ownerId,
      targetOpening: params.targetOpening,
      nextAction: params.nextAction || null,
      health: params.health ?? "GREEN",
    },
  });

  await tx.auditEvent.create({
    data: {
      projectId: created.id,
      actorId: params.actor.id,
      actorEmail: params.actor.email ?? "(no email on file)",
      actorName: params.actor.name,
      actorRole: params.actor.role,
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
      reference: null,
      source: "web",
    },
  });

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

  // See createProject's own comment (same code, moved here): createManyAndReturn
  // + createMany keeps this to 2 round trips instead of ~1,450 sequential ones,
  // comfortably inside Prisma's default 5s interactive-transaction timeout.
  const createdTasks = await tx.task.createManyAndReturn({
    data: seedTasks.map((t) => ({
      projectId: created.id,
      module: t.module,
      category: t.category,
      lifecycleStage: t.lifecycleStage,
      order: t.order,
      title: t.title,
      ownerId: created.ownerId,
      createdById: params.actor.id,
    })),
  });

  await tx.auditEvent.createMany({
    data: createdTasks.map((task) => ({
      projectId: created.id,
      actorId: params.actor.id,
      actorEmail: params.actor.email ?? "(no email on file)",
      actorName: params.actor.name,
      actorRole: params.actor.role,
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
}
