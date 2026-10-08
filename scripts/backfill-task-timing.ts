/**
 * plan.md section 24 (delay tracking, proposed 2026-10-08), S1: "Backfill
 * existing tasks: for tasks already COMPLETED/IN_PROGRESS, reconstruct
 * startedAt/completedAt from the AuditEvent rows where the status changed
 * ... If no such row exists, leave it null; do not guess."
 *
 * `completedAt` is deliberately NOT touched here — both existing
 * status-change call sites (now both routed through
 * src/lib/task-status.ts's applyTaskStatusChange) have always set it
 * correctly the moment a task is completed, so there is nothing to
 * reconstruct there. Only `startedAt` predates that mechanism and needs
 * backfilling.
 *
 * For each task with startedAt still null and a status other than
 * NOT_STARTED/CANCELLED, finds the earliest Task UPDATE AuditEvent whose
 * oldValue.status is "NOT_STARTED" (i.e. the moment it left NOT_STARTED) and
 * uses that event's timestamp. Mirrors scripts/backfill-ops-tasks.ts's
 * shape: dry-run by default, per-project, printed summary.
 *
 * Usage: npx tsx scripts/backfill-task-timing.ts        (dry run, prints only)
 *        npx tsx scripts/backfill-task-timing.ts --apply (writes)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });

  const projects = await db.franchiseProject.findMany({
    select: {
      id: true,
      brand: true,
      location: true,
      tasks: {
        where: {
          startedAt: null,
          status: { notIn: ["NOT_STARTED", "CANCELLED"] },
        },
        select: { id: true, title: true },
      },
    },
  });

  let totalBackfilled = 0;
  let totalSkippedNoEvent = 0;

  for (const project of projects) {
    if (project.tasks.length === 0) continue;

    console.log(`\n${project.brand} — ${project.location} (${project.id})`);
    const toUpdate: { id: string; title: string; startedAt: Date }[] = [];

    for (const task of project.tasks) {
      // Filtering on JSON oldValue.status in the WHERE clause isn't portable
      // across the mixed-shape oldValue payloads this table carries for
      // non-Task entities, so fetch this task's own (small) UPDATE history
      // and scan in memory for the first "left NOT_STARTED" event — not the
      // ~963-task-per-project table scan.
      const events = await db.auditEvent.findMany({
        where: { entityType: "Task", entityId: task.id, action: "UPDATE" },
        orderBy: { createdAt: "asc" },
      });
      const leftNotStartedEvent = events.find((e) => {
        const old = e.oldValue as { status?: string } | null;
        return old?.status === "NOT_STARTED";
      });

      if (!leftNotStartedEvent) {
        totalSkippedNoEvent += 1;
        continue;
      }
      toUpdate.push({ id: task.id, title: task.title, startedAt: leftNotStartedEvent.createdAt });
    }

    if (toUpdate.length === 0) {
      console.log("  no tasks with a reconstructible startedAt.");
      continue;
    }
    console.log(`  ${APPLY ? "backfilling" : "would backfill"} ${toUpdate.length} tasks:`);
    for (const t of toUpdate) {
      console.log(`    startedAt=${t.startedAt.toISOString()}: ${t.title}`);
    }

    if (!APPLY) continue;

    // plan.md section 4: every Task update must write an AuditEvent — same
    // discipline backfill-ops-tasks.ts follows for Task creates.
    await db.$transaction(async (tx) => {
      for (const t of toUpdate) {
        await tx.task.update({ where: { id: t.id }, data: { startedAt: t.startedAt } });
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
            oldValue: { startedAt: null },
            newValue: { startedAt: t.startedAt.toISOString() },
            reference: "Backfilled startedAt from earlier AuditEvent history (plan.md section 24)",
            source: "script",
          },
        });
      }
    });

    totalBackfilled += toUpdate.length;
  }

  console.log(
    `\n${APPLY ? "Done." : "Dry run complete (pass --apply to write)."} Backfilled ${totalBackfilled} tasks total, ${totalSkippedNoEvent} left null (no status-change AuditEvent found).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
