import Link from "next/link";
import { cn } from "cn";
import { LIFECYCLE_STAGE_LABELS } from "@/lib/format";
import { STAGE_STATE_LABELS, type StageState } from "@/lib/lifecycle-stage-status";
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
    <Link
      href={`/projects/${projectId}/stages/${stage}`}
      className={cn(
        "block rounded-lg border p-3 text-left transition-colors hover:border-primary/40",
        status === "completed" && "border-emerald-200 bg-emerald-50",
        status === "in_progress" && "border-primary/30 bg-primary/5",
        status === "upcoming" && "border-border bg-background"
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="mt-1 text-sm font-medium">{LIFECYCLE_STAGE_LABELS[stage]}</div>
      <div
        className={cn(
          "mt-1 text-xs",
          status === "completed" && "text-emerald-700",
          status === "in_progress" && "text-primary",
          status === "upcoming" && "text-muted-foreground"
        )}
      >
        {STAGE_STATE_LABELS[status]}
        {isOverridden && " (override)"}
      </div>
      {total > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {completed}/{total} tasks
        </div>
      )}
    </Link>
  );
}
