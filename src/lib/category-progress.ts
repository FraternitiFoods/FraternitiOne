import type { TaskStatus } from "@prisma/client";
import { computeStageStatus, type StageState } from "@/lib/lifecycle-stage-status";
import { getTaskRoute, type OpsRoute } from "@/lib/ops-route";

export type CategoryProgress = {
  category: string;
  total: number;
  completed: number;
  state: StageState;
};

/**
 * Trade/department roll-up (plan.md section 9, 2026-09-21) — a second axis
 * alongside `lifecycle-stage-status.ts`'s stage roll-up, reading the same
 * Task rows. Driven by `Task.category` (not `module`, which stays RBAC-only)
 * so it can express the real BOQ/Ops master checklist's ~32 trade/department
 * categories, finer-grained than the 13-value `Department` enum. Tasks with
 * no category (the original lifecycle checklist) are excluded — this view
 * only covers the BOQ/Ops-seeded tasks.
 *
 * `route` further splits that into the "BOQ" screen (Excel-sourced line
 * items) and the "Construction & Ops Progress" screen (process checklists
 * that were never in the Excel) — see ops-route.ts.
 */
export function computeCategoryProgress(
  tasks: { category: string | null; status: TaskStatus; title: string }[],
  route: OpsRoute
): CategoryProgress[] {
  const byCategory = new Map<string, { status: TaskStatus }[]>();
  for (const task of tasks) {
    if (!task.category) continue;
    if (getTaskRoute(task.category, task.title) !== route) continue;
    const list = byCategory.get(task.category);
    if (list) {
      list.push(task);
    } else {
      byCategory.set(task.category, [task]);
    }
  }

  return Array.from(byCategory.entries())
    .map(([category, categoryTasks]) => {
      const active = categoryTasks.filter((t) => t.status !== "CANCELLED");
      return {
        category,
        total: active.length,
        completed: active.filter((t) => t.status === "COMPLETED").length,
        state: computeStageStatus(categoryTasks, false),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}
