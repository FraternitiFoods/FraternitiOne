/**
 * Pure percentage rules (dashboard-sheet-sync-plan.md section 5): "per stage
 * = Completed / (leaf rows - Not required); per site overall = same over all
 * stages (leaf rows only, parents excluded)." Shared by the sync commit's
 * sheet-vs-computed mismatch check (src/lib/dashboard-sync/commit.ts) and,
 * later, every Dashboard read page — one place this rule lives, so it can't
 * drift between the two.
 */

export type LeafStepLike = {
  stageNo: number;
  isParent: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED" | null;
  shared: boolean;
};

export type StagePct = { stageNo: number; completed: number; applicable: number; pct: number };

export type SiteStats = {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  notRequired: number;
  pct: number;
  shared: number;
  notShared: number;
  perStage: StagePct[];
};

function pctOf(completed: number, applicable: number): number {
  return applicable > 0 ? completed / applicable : 0;
}

/** Derives a parent step's displayed status from its (non-"Not required") children — dashboard-sheet-sync-plan.md section 3. Parents never count in any % themselves. */
export function deriveParentStatus(
  childStatuses: Array<"NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED" | null>
): "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED" {
  const relevant = childStatuses.filter((s) => s !== "NOT_REQUIRED");
  if (relevant.length === 0) return "NOT_REQUIRED";
  if (relevant.every((s) => s === "COMPLETED")) return "COMPLETED";
  if (relevant.some((s) => s === "COMPLETED" || s === "IN_PROGRESS")) return "IN_PROGRESS";
  return "NOT_STARTED";
}

/** Computes one site's overall + per-stage numbers from its leaf steps only (isParent rows are ignored, per the rule above). */
export function computeSiteStats(leafSteps: LeafStepLike[]): SiteStats {
  const leaves = leafSteps.filter((s) => !s.isParent);

  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  let notRequired = 0;
  let shared = 0;

  const byStage = new Map<number, LeafStepLike[]>();

  for (const step of leaves) {
    if (step.status === "COMPLETED") completed++;
    else if (step.status === "IN_PROGRESS") inProgress++;
    else if (step.status === "NOT_REQUIRED") notRequired++;
    else notStarted++;

    if (step.status !== "NOT_REQUIRED" && step.shared) shared++;

    const list = byStage.get(step.stageNo) ?? [];
    list.push(step);
    byStage.set(step.stageNo, list);
  }

  const total = leaves.length - notRequired;
  const applicableNonShared = total - shared;

  const perStage: StagePct[] = [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stageNo, steps]) => {
      const stageNotRequired = steps.filter((s) => s.status === "NOT_REQUIRED").length;
      const stageCompleted = steps.filter((s) => s.status === "COMPLETED").length;
      const applicable = steps.length - stageNotRequired;
      return { stageNo, completed: stageCompleted, applicable, pct: pctOf(stageCompleted, applicable) };
    });

  return {
    total,
    completed,
    inProgress,
    notStarted,
    notRequired,
    pct: pctOf(completed, total),
    shared,
    notShared: Math.max(0, applicableNonShared),
    perStage,
  };
}
