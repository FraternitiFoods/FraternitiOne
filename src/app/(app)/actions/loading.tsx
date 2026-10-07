import { StatCard } from "@/components/stat-card";

/**
 * Streamed in immediately on navigation while the Action Centre queries
 * resolve. Uses plain placeholders instead of PageHeader — loading.tsx
 * can't know the user's role (isFranchisee) without its own session check,
 * which would defeat the point of a fast fallback.
 */
export default function ActionsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-36 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Critical" value="—" />
        <StatCard label="Overdue" value="—" />
        <StatCard label="Awaiting You" value="—" />
        <StatCard label="Completed This Week" value="—" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 w-full rounded-xl bg-muted ring-1 ring-foreground/10" />
        ))}
      </div>
    </div>
  );
}
