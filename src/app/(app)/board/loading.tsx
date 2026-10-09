import { StatCard } from "@/components/stat-card";

/** Streamed in immediately on navigation while the board summary queries resolve (section 22 pattern). */
export default function BoardSummaryLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Projects" value="—" />
        <StatCard label="On Track" value="—" />
        <StatCard label="At Risk" value="—" />
        <StatCard label="Critical" value="—" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 w-full rounded-xl bg-muted ring-1 ring-foreground/10" />
        ))}
      </div>
    </div>
  );
}
