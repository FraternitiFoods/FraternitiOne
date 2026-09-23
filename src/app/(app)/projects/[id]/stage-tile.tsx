import { LIFECYCLE_STAGE_LABELS } from "@/lib/format";
import { type StageState } from "@/lib/lifecycle-stage-status";
import { ProgressTile } from "./progress-tile";
import type { LifecycleStage } from "@prisma/client";

/** Tapping a tile navigates to its own page (/projects/[id]/stages/[stage])
 * rather than opening a dialog — a dedicated page has room for the task
 * list, reordering, and the add-task form without feeling cramped. */
export function StageTile({
  stage,
  index,
  status,
  isOverridden,
  total,
  completed,
  projectId,
}: {
  stage: LifecycleStage;
  index: number;
  status: StageState;
  isOverridden: boolean;
  total: number;
  completed: number;
  projectId: string;
}) {
  return (
    <ProgressTile
      href={`/projects/${projectId}/stages/${stage}`}
      eyebrow={String(index + 1).padStart(2, "0")}
      label={LIFECYCLE_STAGE_LABELS[stage]}
      status={status}
      statusSuffix={isOverridden ? " (override)" : undefined}
      total={total}
      completed={completed}
    />
  );
}
