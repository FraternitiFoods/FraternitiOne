import Link from "next/link";
import { cn } from "cn";
import { STAGE_STATE_LABELS, type StageState } from "@/lib/lifecycle-stage-status";

/**
 * Shared card chrome for the "Franchise Lifecycle" and "Construction & Ops
 * Progress" tile grids — same border/background/hover treatment either way,
 * so the two grids read as one visual system. `eyebrow` is the stage index
 * badge ("01", "02", ...); categories have no ordinal so they omit it.
 */
export function ProgressTile({
  href,
  eyebrow,
  label,
  status,
  statusSuffix,
  total,
  completed,
}: {
  href: string;
  eyebrow?: string;
  label: string;
  status: StageState;
  statusSuffix?: string;
  total: number;
  completed: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative block rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:shadow-sm",
        status === "completed" && "border-emerald-200 bg-emerald-50",
        status === "in_progress" && "border-primary/30 bg-primary/5",
        status === "upcoming" && "border-border bg-background"
      )}
    >
      <span className="absolute right-2 top-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        →
      </span>
      {eyebrow && <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>}
      <div className={cn("text-sm font-medium", eyebrow && "mt-1")}>{label}</div>
      <div
        className={cn(
          "mt-1 text-xs",
          status === "completed" && "text-emerald-700",
          status === "in_progress" && "text-primary",
          status === "upcoming" && "text-muted-foreground"
        )}
      >
        {STAGE_STATE_LABELS[status]}
        {statusSuffix}
      </div>
      {total > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {completed}/{total} tasks
        </div>
      )}
    </Link>
  );
}
