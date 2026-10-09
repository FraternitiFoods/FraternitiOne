import "server-only";

import { db } from "@/lib/db";
import { getAdminWidgets } from "@/lib/dashboard/widgets";
import { getTaskTiming, summarizeDelays, type DelaySummaryTask } from "@/lib/task-timing";

/**
 * Founder/board summary (/board screen + the weekly email digest PDF) — a
 * single aggregator so the live screen and the PDF can never show different
 * numbers for the same moment. Deliberately recombines data the app already
 * computes elsewhere (dashboard's portfolio-health counts + admin widgets,
 * /delays' bounded tracked-task query + summarizeDelays) rather than
 * inventing any new revenue/stage logic — the founder hasn't signed off on
 * any new figures, only on seeing the existing ones in one place.
 */

export type BoardSummary = {
  generatedAt: Date;
  health: { total: number; onTrack: number; atRisk: number; critical: number };
  onboarding: Awaited<ReturnType<typeof getAdminWidgets>>;
  delays: Omit<ReturnType<typeof summarizeDelays>, "topLate"> & {
    topLate: (DelaySummaryTask & {
      daysOverdue: number;
      storeLabel: string;
    })[];
  };
};

export async function getBoardSummary(): Promise<BoardSummary> {
  const [total, onTrack, atRisk, critical, onboarding, rawTasks] = await Promise.all([
    db.franchiseProject.count(),
    db.franchiseProject.count({ where: { health: "GREEN" } }),
    db.franchiseProject.count({ where: { health: "AMBER" } }),
    db.franchiseProject.count({ where: { health: { in: ["RED", "CRITICAL"] } } }),
    getAdminWidgets(),
    // Same bounded "opted into tracking" query /delays/page.tsx uses — only
    // tasks with a manual due date or an SLA ever enter a delay number.
    db.task.findMany({
      where: {
        status: { not: "CANCELLED" },
        OR: [{ slaDays: { not: null } }, { dueDate: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        module: true,
        lifecycleStage: true,
        status: true,
        dueDate: true,
        startedAt: true,
        completedAt: true,
        slaDays: true,
        owner: { select: { name: true } },
        project: { select: { seq: true, brand: true, location: true } },
      },
    }),
  ]);

  const delayInputs: DelaySummaryTask[] = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    module: t.module,
    lifecycleStage: t.lifecycleStage,
    status: t.status,
    dueDate: t.dueDate,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    slaDays: t.slaDays,
    ownerName: t.owner.name,
  }));

  const delaySummary = summarizeDelays(delayInputs, { topN: 5 });

  // Board view wants the store name on its "top late" list, the same reason
  // /delays/page.tsx recomputes this itself instead of using
  // summary.topLate (the generic DelaySummaryTask shape has no store field).
  const topLate = rawTasks
    .map((t) => ({ ...t, timing: getTaskTiming(t) }))
    .filter((t): t is typeof t & { timing: { kind: "OVERDUE"; dueDate: Date; daysOverdue: number } } =>
      t.timing.kind === "OVERDUE"
    )
    .sort((a, b) => b.timing.daysOverdue - a.timing.daysOverdue)
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      module: t.module,
      lifecycleStage: t.lifecycleStage,
      status: t.status,
      dueDate: t.dueDate,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      slaDays: t.slaDays,
      ownerName: t.owner.name,
      daysOverdue: t.timing.daysOverdue,
      storeLabel: `${t.project.brand}, ${t.project.location}`,
    }));

  return {
    generatedAt: new Date(),
    health: { total, onTrack, atRisk, critical },
    onboarding,
    delays: { ...delaySummary, topLate },
  };
}
