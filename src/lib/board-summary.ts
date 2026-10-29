import "server-only";

import { unstable_cache } from "next/cache";
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
 *
 * plan.md performance pass: wrapped in `unstable_cache` with a short
 * revalidate window, same narrow exception/reasoning as `getAdminWidgets`
 * (dashboard/widgets.ts) — this also covers the unbounded portfolio-wide
 * `task.findMany` below, which genuinely needs every tracked task to
 * compute correct totals (truncating it would silently corrupt the
 * founder's numbers), so caching the whole computation for ~20s is the
 * safe way to cut its real cost rather than limiting its row set.
 *
 * `unstable_cache` round-trips its return value through JSON, so a `Date`
 * put in only ever comes back out as a string — `generatedAt` is typed and
 * produced as a string (not `.toISOString()`'d by callers) for exactly
 * this reason. `topLate` only carries the fields its two consumers
 * (board/page.tsx, board-digest-pdf.ts) actually render — none of them are
 * `Date`s, so this doesn't recur there.
 */

export type BoardSummary = {
  generatedAt: string;
  health: { total: number; onTrack: number; atRisk: number; critical: number };
  onboarding: Awaited<ReturnType<typeof getAdminWidgets>>;
  delays: Omit<ReturnType<typeof summarizeDelays>, "topLate"> & {
    topLate: {
      id: string;
      title: string;
      module: DelaySummaryTask["module"];
      daysOverdue: number;
      storeLabel: string;
    }[];
  };
};

export const getBoardSummary = unstable_cache(
  async function getBoardSummaryUncached(): Promise<BoardSummary> {
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
        daysOverdue: t.timing.daysOverdue,
        storeLabel: `${t.project.brand}, ${t.project.location}`,
      }));

    return {
      generatedAt: new Date().toISOString(),
      health: { total, onTrack, atRisk, critical },
      onboarding,
      delays: { ...delaySummary, topLate },
    };
  },
  ["board-summary"],
  { revalidate: 20 }
);
