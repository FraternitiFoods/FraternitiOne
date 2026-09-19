import type { LifecycleStage, TaskStatus } from "@prisma/client";
import { LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_ORDER } from "@/lib/format";

export type StageState = "upcoming" | "in_progress" | "completed";

export const STAGE_STATE_LABELS: Record<StageState, string> = {
  upcoming: "Upcoming",
  in_progress: "In Progress",
  completed: "Completed",
};

/**
 * A stage's status is derived from its own tasks, not from any project-wide
 * "current stage" field — stages are independent/parallel (multiple can be
 * in progress at once). CANCELLED tasks are excluded: they neither block
 * completion nor count as "started". `isOverridden` (an admin
 * ProjectStageOverride row) always wins, even with open tasks.
 */
export function computeStageStatus(
  tasks: { status: TaskStatus }[],
  isOverridden: boolean
): StageState {
  if (isOverridden) return "completed";

  const active = tasks.filter((t) => t.status !== "CANCELLED");
  if (active.length === 0) return "upcoming";
  if (active.every((t) => t.status === "COMPLETED")) return "completed";
  if (active.every((t) => t.status === "NOT_STARTED")) return "upcoming";
  return "in_progress";
}

/**
 * Portfolio-level "Stage" summary for a project (projects list page) — the
 * earliest stage (in LIFECYCLE_STAGE_ORDER) that isn't yet completed, or
 * "All stages complete" once every stage is. Replaces the old single
 * FranchiseProject.lifecycleStage field now that stages run independently.
 */
export function summarizeProjectStage(
  tasks: { status: TaskStatus; lifecycleStage: LifecycleStage }[],
  overriddenStages: Set<LifecycleStage>
): string {
  for (const stage of LIFECYCLE_STAGE_ORDER) {
    const stageTasks = tasks.filter((t) => t.lifecycleStage === stage);
    const state = computeStageStatus(stageTasks, overriddenStages.has(stage));
    if (state !== "completed") {
      return LIFECYCLE_STAGE_LABELS[stage];
    }
  }
  return "All stages complete";
}
