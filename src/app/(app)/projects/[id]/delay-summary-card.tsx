import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { DEPARTMENT_LABELS, LIFECYCLE_STAGE_LABELS } from "@/lib/format";
import type { DelaySummary } from "@/lib/task-timing";

/**
 * plan.md section 24 S3, per-project card. Rule 9 / NOT DECIDED #6 working
 * default: a franchisee sees only their own overdue count — never the
 * department/stage breakdown or the named "who's late" list, since that's
 * internal performance information about staff, not about their store.
 * Every internal role that can already view this project sees the full
 * breakdown (not gated behind `canViewDelaysDashboard`, which is only for
 * the cross-portfolio `/delays` screen).
 */
export function DelaySummaryCard({
  summary,
  isFranchisee,
}: {
  summary: DelaySummary;
  isFranchisee: boolean;
}) {
  const nothingTracked =
    summary.runningOnTrack + summary.runningOverdue + summary.finishedOnTime + summary.finishedLate === 0;

  if (nothingTracked) return null;

  if (isFranchisee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery health</CardTitle>
        </CardHeader>
        <CardContent>
          <StatCard
            label="Overdue"
            value={summary.runningOverdue}
            caption={summary.runningOverdue > 0 ? "Past their time limit" : "Nothing overdue"}
            captionClassName={summary.runningOverdue > 0 ? "text-red-600" : "text-emerald-600"}
            className="max-w-xs"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Delivery health</CardTitle>
        <p className="text-xs text-muted-foreground">Where this store is stuck, by milestone task (plan.md section 24)</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="On Track" value={summary.runningOnTrack} captionClassName="text-emerald-600" />
          <StatCard
            label="Overdue"
            value={summary.runningOverdue}
            captionClassName={summary.runningOverdue > 0 ? "text-red-600" : undefined}
          />
          <StatCard label="Finished On Time" value={summary.finishedOnTime} captionClassName="text-emerald-600" />
          <StatCard
            label="Finished Late"
            value={summary.finishedLate}
            captionClassName={summary.finishedLate > 0 ? "text-amber-600" : undefined}
          />
          <StatCard label="Avg Days Overdue" value={summary.averageDaysOverdue} caption="Across open overdue tasks" />
        </div>

        {summary.byDepartment.length > 0 && (
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Late days by department
            </h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {summary.byDepartment.map((b) => (
                <li key={b.key} className="flex items-center justify-between">
                  <span>{DEPARTMENT_LABELS[b.key]}</span>
                  <span className="text-muted-foreground">
                    {b.count} task{b.count === 1 ? "" : "s"} · {b.totalDaysOverdue} day
                    {b.totalDaysOverdue === 1 ? "" : "s"} late
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.byStage.length > 0 && (
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Late days by stage</h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {summary.byStage.map((b) => (
                <li key={b.key} className="flex items-center justify-between">
                  <span>{LIFECYCLE_STAGE_LABELS[b.key]}</span>
                  <span className="text-muted-foreground">
                    {b.count} task{b.count === 1 ? "" : "s"} · {b.totalDaysOverdue} day
                    {b.totalDaysOverdue === 1 ? "" : "s"} late
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.topLate.length > 0 && (
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Most late tasks</h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {summary.topLate.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {t.title} <span className="text-muted-foreground">— {t.ownerName}</span>
                  </span>
                  <span className="shrink-0 font-medium text-red-600">
                    {t.daysOverdue} day{t.daysOverdue === 1 ? "" : "s"} late
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
