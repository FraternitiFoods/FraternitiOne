/**
 * plan.md section 24 (delay tracking, proposed 2026-10-08), S1: template
 * changes (here, filling in src/lib/task-sla-defaults.ts once the exported
 * CSV comes back from Apoorv/the ops heads) only apply to newly-seeded
 * projects (project-seed.ts) — existing projects' tasks need their `slaDays`
 * backfilled separately. Mirrors scripts/backfill-ops-tasks.ts's shape:
 * dry-run by default, whitespace-normalized title matching, per-project.
 *
 * Idempotent and safe to re-run any time TASK_SLA_DEFAULTS changes — only
 * touches tasks whose `slaDays` is currently null.
 *
 * Usage: npx tsx scripts/backfill-task-sla.ts        (dry run, prints only)
 *        npx tsx scripts/backfill-task-sla.ts --apply (writes)
 */
import { PrismaClient } from "@prisma/client";
import { TASK_SLA_DEFAULTS, normalizeTaskTitle } from "../src/lib/task-sla-defaults";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (Object.keys(TASK_SLA_DEFAULTS).length === 0) {
    console.log("TASK_SLA_DEFAULTS is empty — nothing to backfill yet. Fill it in once the SLA CSV comes back.");
    return;
  }

  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });

  const projects = await db.franchiseProject.findMany({
    select: {
      id: true,
      brand: true,
      location: true,
      tasks: { where: { slaDays: null }, select: { id: true, title: true } },
    },
  });

  let totalUpdated = 0;

  for (const project of projects) {
    const toUpdate = project.tasks
      .map((t) => ({ id: t.id, title: t.title, slaDays: TASK_SLA_DEFAULTS[normalizeTaskTitle(t.title)] }))
      .filter((t): t is { id: string; title: string; slaDays: number } => t.slaDays !== undefined);

    console.log(`\n${project.brand} — ${project.location} (${project.id})`);
    if (toUpdate.length === 0) {
      console.log("  no matching untracked tasks to update.");
      continue;
    }
    console.log(`  ${APPLY ? "updating" : "would update"} ${toUpdate.length} tasks:`);
    for (const t of toUpdate) {
      console.log(`    slaDays=${t.slaDays}: ${t.title}`);
    }

    if (!APPLY) continue;

    // plan.md section 4: every Task update must write an AuditEvent — same
    // discipline backfill-ops-tasks.ts follows for Task creates.
    await db.$transaction(async (tx) => {
      for (const t of toUpdate) {
        await tx.task.update({ where: { id: t.id }, data: { slaDays: t.slaDays } });
        await tx.auditEvent.create({
          data: {
            projectId: project.id,
            actorId: admin.id,
            actorEmail: admin.email ?? "(no email on file)",
            actorName: admin.name,
            actorRole: admin.role,
            entityType: "Task",
            entityId: t.id,
            action: "UPDATE",
            oldValue: { slaDays: null },
            newValue: { slaDays: t.slaDays },
            reference: "Backfilled from task-sla-defaults.ts (plan.md section 24)",
            source: "script",
          },
        });
      }
    });

    totalUpdated += toUpdate.length;
  }

  console.log(`\n${APPLY ? "Done." : "Dry run complete (pass --apply to write)."} Updated ${totalUpdated} tasks total.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
