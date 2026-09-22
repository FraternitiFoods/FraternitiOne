import { cn } from "cn";
import { STAGE_STATE_LABELS, type StageState } from "@/lib/lifecycle-stage-status";

/**
 * Read-only "barometer" tile (plan.md section 9) — no drill-down page yet,
 * unlike StageTile: the founder's ask was a rolled-up percentage per
 * trade/department ("construction itna pahunch gya"), not a new place to
 * manage tasks — those are still managed from the flat Tasks list below.
 */
export function CategoryTile({ category, total, completed, state }: {
  category: string;
  total: number;
  completed: number;
  state: StageState;
}) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    // No border, no hover state, no Link — deliberately flatter than
    // StageTile so it doesn't visually imply the tile is clickable (it isn't;
    // this is a read-only rollup, see the file-level comment above).
    <div
      className={cn(
        "cursor-default rounded-lg p-3",
        state === "completed" && "bg-emerald-50",
        state === "in_progress" && "bg-primary/5",
        state === "upcoming" && "bg-muted/40"
      )}
    >
      <div className="text-sm font-medium">{category}</div>
      <div
        className={cn(
          "mt-1 text-xs",
          state === "completed" && "text-emerald-700",
          state === "in_progress" && "text-primary",
          state === "upcoming" && "text-muted-foreground"
        )}
      >
        {STAGE_STATE_LABELS[state]} · {completed}/{total}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            state === "completed" ? "bg-emerald-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
