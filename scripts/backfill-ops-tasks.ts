/**
 * One-off backfill (2026-09-23): OPS_PROGRESS_TASK_TEMPLATES only seeds tasks
 * for a project at `createProject` time (see projects/actions.ts), so
 * projects created before a template update never retroactively pick up new
 * template rows. This script diffs each existing project's tasks against the
 * current template and inserts whatever's missing, mirroring createProject's
 * bulk-insert shape (Task + matching AuditEvent rows) exactly.
 *
 * New rows are appended to the end of their (project, lifecycleStage) order
 * sequence rather than spliced into the middle — splicing would mean
 * renumbering every existing task sharing that lifecycle stage across every
 * category, which risks disturbing unrelated ordering. Projects created after
 * this backfill get correctly-interleaved order from the start, same as
 * always.
 *
 * Usage: npx tsx scripts/backfill-ops-tasks.ts        (dry run, prints only)
 *        npx tsx scripts/backfill-ops-tasks.ts --apply (writes)
 */
import { PrismaClient, type Department, type LifecycleStage } from "@prisma/client";
import { OPS_PROGRESS_TASK_TEMPLATES } from "../src/lib/ops-progress-tasks";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/**
 * Whitespace-normalized so incidental formatting-only edits to an existing
 * template row (e.g. trailing-space fidelity to a raw Excel cell) don't read
 * as a "new" item and get inserted as a near-duplicate alongside the
 * already-seeded row — only genuinely new (category, title) pairs should
 * match here.
 */
function key(category: string | null, title: string): string {
  const norm = title.replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return `${category ?? ""}::${norm}`;
}

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "tech@fraterniti.co.in" } });

  const projects = await db.franchiseProject.findMany({
    select: {
      id: true,
      brand: true,
      location: true,
      ownerId: true,
      tasks: { select: { category: true, title: true, lifecycleStage: true, order: true } },
    },
  });

  let totalInserted = 0;

  for (const project of projects) {
    const existingKeys = new Set(project.tasks.map((t) => key(t.category, t.title)));
    const maxOrderByStage = new Map<LifecycleStage, number>();
    for (const t of project.tasks) {
      const cur = maxOrderByStage.get(t.lifecycleStage) ?? -1;
      if (t.order > cur) maxOrderByStage.set(t.lifecycleStage, t.order);
    }

    type NewTask = {
      module: Department;
      category: string;
      lifecycleStage: LifecycleStage;
      order: number;
      title: string;
    };
    const toInsert: NewTask[] = [];
    const perCategoryCount = new Map<string, number>();

    for (const item of OPS_PROGRESS_TASK_TEMPLATES) {
      if (existingKeys.has(key(item.category, item.title))) continue;
      const nextOrder = (maxOrderByStage.get(item.lifecycleStage) ?? -1) + 1;
      maxOrderByStage.set(item.lifecycleStage, nextOrder);
      toInsert.push({
        module: item.module,
        category: item.category,
        lifecycleStage: item.lifecycleStage,
        order: nextOrder,
        title: item.title,
      });
      perCategoryCount.set(item.category, (perCategoryCount.get(item.category) ?? 0) + 1);
    }

    console.log(`\n${project.brand} — ${project.location} (${project.id})`);
    if (toInsert.length === 0) {
      console.log("  already up to date, nothing to insert.");
      continue;
    }
    console.log(`  ${APPLY ? "inserting" : "would insert"} ${toInsert.length} tasks:`);
    for (const [cat, n] of perCategoryCount) {
      console.log(`    ${cat}: +${n}`);
    }

    if (!APPLY) continue;

    await db.$transaction(async (tx) => {
      const created = await tx.task.createManyAndReturn({
        data: toInsert.map((t) => ({
          projectId: project.id,
          module: t.module,
          category: t.category,
          lifecycleStage: t.lifecycleStage,
          order: t.order,
          title: t.title,
          ownerId: project.ownerId,
          createdById: admin.id,
        })),
      });

      await tx.auditEvent.createMany({
        data: created.map((task) => ({
          projectId: project.id,
          actorId: admin.id,
          actorEmail: admin.email,
          actorName: admin.name,
          actorRole: admin.role,
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
          reference: "Backfilled from BOQ template update (2026-09-23)",
          source: "script",
        })),
      });
    });

    totalInserted += toInsert.length;
  }

  console.log(`\n${APPLY ? "Done." : "Dry run complete (pass --apply to write)."} Inserted ${totalInserted} tasks total.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
