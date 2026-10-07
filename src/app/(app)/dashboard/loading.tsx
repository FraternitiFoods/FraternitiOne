import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Streamed in immediately on navigation while the dashboard query resolves.
 * This route renders three different layouts depending on role (Franchisee /
 * Sales / Internal) — loading.tsx can't know which without its own session
 * check, which would defeat the point, so this is a generic skeleton that's
 * reasonable for all three rather than an exact match of any one.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-64 rounded bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="—" value="—" />
        <StatCard label="—" value="—" />
        <StatCard label="—" value="—" />
        <StatCard label="—" value="—" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <div className="h-4 w-40 rounded bg-muted" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 w-full rounded bg-muted" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
