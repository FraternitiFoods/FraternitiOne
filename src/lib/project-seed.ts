import "server-only";

import type { Prisma, Department, LifecycleStage, ProjectHealth, Role } from "@prisma/client";
import { LIFECYCLE_STAGE_ORDER } from "@/lib/format";
import { STAGE_DEFAULT_DEPARTMENT, STAGE_TASK_TEMPLATES } from "@/lib/lifecycle-stage-tasks";
import { OPS_PROGRESS_TASK_TEMPLATES } from "@/lib/ops-progress-tasks";
import { TASK_SLA_DEFAULTS, normalizeTaskTitle } from "@/lib/task-sla-defaults";

/**
 * Extracted from the createProject Server Action (src/app/(app)/projects/
 * actions.ts) so plan.md section 17's onboarding-conversion path (see
 * src/lib/onboarding/conversion.ts) can create a FranchiseProject the exact
 * same way — same seeded ~963 tasks, same audit trail shape — without
 * reimplementing task seeding (build-order step 7's own instruction).
 * `createProject` itself now calls this too, so there is exactly one place
 * that knows how a project gets seeded.
 */
/**
 * Marks the bulk per-task AuditEvent rows written below as seed noise, not a
 * human/system action — the dashboard's "recent activity" glance widgets
 * (InternalDashboard, FranchiseeDashboard, dashboard/page.tsx) filter these
 * out so creating a project (~963 seeded tasks) doesn't drown the feed in
 * near-identical rows. /audit (the full FR-010 compliance log) does NOT
 * filter on this — it must keep showing every seeded task.
 */
export const SEED_TASK_AUDIT_REFERENCE = "Auto-seeded from lifecycle checklist";

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
    /**
     * False for a franchise that was already built and operating before
     * joining the platform (admin marks this via /projects/new, defaulted
     * from User.isPreExistingFranchisee) — skips the ~963-task lifecycle
     * seed entirely and marks the project `isPreExisting`. Defaults to
     * `true` so the onboarding-conversion caller (conversion.ts), which never
     * passes this, keeps seeding exactly as before.
     */
    seedTasks?: boolean;
  }
) {
  const seedTasks = params.seedTasks ?? true;

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
      isPreExisting: !seedTasks,
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

  // Skipped entirely for an already-operational franchise (isPreExisting) —
  // there is no build-out to track, so no lifecycle Task rows get created.
  if (seedTasks) {
    await seedLifecycleAndOpsTasks(tx, created, params.actor);
  }

  return created;
}

/**
 * The ~963-task lifecycle + BOQ/Ops seed, extracted out of
 * `createProjectWithSeedTasks` so a project that was marked `isPreExisting`
 * by mistake and gets reclassified back to a normal build-out later (see
 * `reclassifyProject`, src/app/(app)/projects/actions.ts) can seed the exact
 * same checklist against its *existing* row, instead of only new projects
 * ever getting it.
 */
export async function seedLifecycleAndOpsTasks(
  tx: Prisma.TransactionClient,
  project: { id: string; ownerId: string },
  actor: { id: string; name: string; email: string | null; role: Role }
) {
  type SeedTaskInput = {
    module: Department;
    category: string | null;
    lifecycleStage: LifecycleStage;
    order: number;
    title: string;
    slaDays: number | null;
  };

  const seedTaskInputs: SeedTaskInput[] = [];
  const nextOrderByStage = new Map<LifecycleStage, number>();
  for (const stage of LIFECYCLE_STAGE_ORDER) {
    STAGE_TASK_TEMPLATES[stage].forEach((title, order) => {
      seedTaskInputs.push({
        module: STAGE_DEFAULT_DEPARTMENT[stage],
        category: null,
        lifecycleStage: stage,
        order,
        title,
        slaDays: TASK_SLA_DEFAULTS[normalizeTaskTitle(title)] ?? null,
      });
    });
    nextOrderByStage.set(stage, STAGE_TASK_TEMPLATES[stage].length);
  }
  for (const item of OPS_PROGRESS_TASK_TEMPLATES) {
    const order = nextOrderByStage.get(item.lifecycleStage) ?? 0;
    nextOrderByStage.set(item.lifecycleStage, order + 1);
    seedTaskInputs.push({
      module: item.module,
      category: item.category,
      lifecycleStage: item.lifecycleStage,
      order,
      title: item.title,
      slaDays: TASK_SLA_DEFAULTS[normalizeTaskTitle(item.title)] ?? null,
    });
  }

  // createManyAndReturn + createMany keeps this to 2 round trips instead of
  // ~1,450 sequential ones. Still measured 5.2-5.5s against the production
  // DB — over Prisma's default 5s interactive-transaction timeout — so every
  // caller (projects/actions.ts, esign/webhook-processor.ts, and now
  // reclassifyProject) passes an explicit longer `timeout` to its own
  // `$transaction` call.
  const createdTasks = await tx.task.createManyAndReturn({
    data: seedTaskInputs.map((t) => ({
      projectId: project.id,
      module: t.module,
      category: t.category,
      lifecycleStage: t.lifecycleStage,
      order: t.order,
      title: t.title,
      slaDays: t.slaDays,
      ownerId: project.ownerId,
      createdById: actor.id,
    })),
  });

  await tx.auditEvent.createMany({
    data: createdTasks.map((task) => ({
      projectId: project.id,
      actorId: actor.id,
      actorEmail: actor.email ?? "(no email on file)",
      actorName: actor.name,
      actorRole: actor.role,
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
      reference: SEED_TASK_AUDIT_REFERENCE,
      source: "web",
    })),
  });

  return createdTasks;
}
