import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Streamed in immediately on navigation while the onboarding overview query resolves. */
export default function OnboardingHomeLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-64 rounded bg-muted" />
        <div className="h-4 w-40 rounded bg-muted" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-6 w-28 rounded-full bg-muted" />
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="h-4 w-24 rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-4 w-72 rounded bg-muted" />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="h-4 w-24 rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="h-6 w-20 rounded bg-muted" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="h-4 w-28 rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-6 w-20 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Onboarding Completion" value="—" />
        <StatCard label="LOI Status" value="—" />
      </div>

      <Card>
        <CardHeader>
          <div className="h-4 w-32 rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}
