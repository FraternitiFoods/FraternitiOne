import { StatCard } from "@/components/stat-card";

/** Streamed in immediately on navigation while the project header query resolves. */
export default function ProjectDetailLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-56 rounded bg-muted" />
          <div className="h-4 w-96 rounded bg-muted" />
        </div>
      </div>

      <div className="h-10 rounded-lg bg-card ring-1 ring-foreground/10" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Site Progress" value="—" />
        <StatCard label="Open Tasks" value="—" />
        <StatCard label="Days to Launch" value="—" />
        <StatCard label="Health" value="—" />
        <StatCard label="Open Complaints" value="—" />
      </div>

      <div className="h-40 rounded-xl bg-card ring-1 ring-foreground/10" />
      <div className="h-64 rounded-xl bg-card ring-1 ring-foreground/10" />
    </div>
  );
}
