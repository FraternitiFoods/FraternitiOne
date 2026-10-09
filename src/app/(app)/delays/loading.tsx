import { StatCard } from "@/components/stat-card";

/** Streamed in immediately on navigation while the portfolio delay queries resolve (section 22 pattern). */
export default function DelaysLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
      </div>

      <div className="h-16 w-full rounded-xl bg-muted ring-1 ring-foreground/10" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Running On Time" value="—" />
        <StatCard label="Running Overdue" value="—" />
        <StatCard label="Finished On Time" value="—" />
        <StatCard label="Finished Late" value="—" />
        <StatCard label="Avg Days Overdue" value="—" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 w-full rounded-xl bg-muted ring-1 ring-foreground/10" />
        ))}
      </div>
    </div>
  );
}
