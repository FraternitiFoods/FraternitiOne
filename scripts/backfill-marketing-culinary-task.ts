/**
 * One-off backfill (2026-10-17): OPS_PROGRESS_TASK_TEMPLATES' "Marketing
 * Promotion Offers" row (category CULINARY — it's part of Culinary's own
 * pre-opening checklist, not an actual Marketing-department item) carried
 * the wrong `module`/`lifecycleStage` ever since the CULINARY block rebuild
 * noted in plan.md — it had `module: MARKETING`, `lifecycleStage:
 * PRE_LAUNCH_MARKETING` instead of matching its real siblings
 * (`module: OPERATIONS`, `lifecycleStage: OPERATIONS_PREPARATION`). The
 * template is now fixed (ops-progress-tasks.ts), but every project seeded
 * before this fix still has the old wrong values baked into its Task row —
 * this script corrects those rows in place.
 *
 * Usage: npx tsx scripts/backfill-marketing-culinary-task.ts        (dry run, prints only)
 *        npx tsx scripts/backfill-marketing-culinary-task.ts --apply (writes)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const TITLE = "Marketing Promotion Offers";
const CATEGORY = "CULINARY";

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });

  const affected = await db.task.findMany({
    where: {
      category: CATEGORY,
      title: TITLE,
      OR: [{ module: { not: "OPERATIONS" } }, { lifecycleStage: { not: "OPERATIONS_PREPARATION" } }],
    },
    select: { id: true, projectId: true, module: true, lifecycleStage: true, order: true },
  });

  if (affected.length === 0) {
    console.log("Nothing to fix — every project already has the correct values.");
    return;
  }

  console.log(`${APPLY ? "Fixing" : "Would fix"} ${affected.length} task(s):`);

  for (const task of affected) {
    const maxOrder = await db.task.aggregate({
      where: { projectId: task.projectId, lifecycleStage: "OPERATIONS_PREPARATION" },
      _max: { order: true },
    });
    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    console.log(
      `  project ${task.projectId}: module ${task.module} -> OPERATIONS, lifecycleStage ${task.lifecycleStage} -> OPERATIONS_PREPARATION, order ${task.order} -> ${nextOrder}`
    );

    if (!APPLY) continue;

    await db.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { module: "OPERATIONS", lifecycleStage: "OPERATIONS_PREPARATION", order: nextOrder },
      });

      await tx.auditEvent.create({
        data: {
          projectId: task.projectId,
          actorId: admin.id,
          actorEmail: admin.email ?? "(no email on file)",
          actorName: admin.name,
          actorRole: admin.role,
          entityType: "Task",
          entityId: task.id,
          action: "UPDATE",
          oldValue: { module: task.module, lifecycleStage: task.lifecycleStage, order: task.order },
          newValue: { module: updated.module, lifecycleStage: updated.lifecycleStage, order: updated.order },
          reference: "Backfilled: corrected miscategorized CULINARY task (2026-10-17)",
          source: "script",
        },
      });
    });
  }

  console.log(APPLY ? "\nDone." : "\nDry run complete (pass --apply to write).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
