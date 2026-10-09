import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewDelaysDashboard } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DEPARTMENT_LABELS,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_ORDER,
  formatProjectCode,
} from "@/lib/format";
import {
  effectiveDue,
  getTaskTiming,
  summarizeDelays,
  toIstDateKey,
  type DelaySummaryTask,
} from "@/lib/task-timing";
import type { LifecycleStage, Prisma } from "@prisma/client";

/**
 * plan.md section 24 S3 — the portfolio-wide "where is it stuck" screen,
 * the one the plan calls "the screen the founder is most likely to want".
 * ADMIN/MANAGEMENT only (`canViewDelaysDashboard`); a franchisee's own
 * per-project delay card lives on the project page instead and never shows
 * this department-level breakdown (rule 9).
 */
export default async function DelaysPage(props: PageProps<"/delays">) {
  const user = await requireUser();
  if (!canViewDelaysDashboard(user)) {
    redirect("/dashboard");
  }

  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const stageParam = searchParams.stage;
  const fromParam = searchParams.from;
  const toParam = searchParams.to;

  const projectFilter = typeof projectParam === "string" && projectParam ? projectParam : "";
  const stageFilter =
    typeof stageParam === "string" && LIFECYCLE_STAGE_ORDER.includes(stageParam as LifecycleStage)
      ? (stageParam as LifecycleStage)
      : "";
  const fromFilter = typeof fromParam === "string" ? fromParam : "";
  const toFilter = typeof toParam === "string" ? toParam : "";

  // Only tasks someone opted into tracking (manual due date or an SLA) ever
  // enter a delay number (rule 1) — this keeps the row count bounded to the
  // ~20-30 milestone tasks per store the plan calls for, never every seeded
  // task across every store.
  const where: Prisma.TaskWhereInput = {
    status: { not: "CANCELLED" },
    OR: [{ slaDays: { not: null } }, { dueDate: { not: null } }],
    ...(projectFilter ? { projectId: projectFilter } : {}),
    ...(stageFilter ? { lifecycleStage: stageFilter } : {}),
  };

  const [rawTasks, projects] = await Promise.all([
    db.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        module: true,
        lifecycleStage: true,
        status: true,
        dueDate: true,
        startedAt: true,
        completedAt: true,
        slaDays: true,
        owner: { select: { name: true } },
        project: { select: { id: true, seq: true, brand: true, location: true } },
      },
    }),
    db.franchiseProject.findMany({
      select: { id: true, seq: true, brand: true, location: true },
      orderBy: [{ brand: "asc" }, { location: "asc" }],
    }),
  ]);

  // The date-range filter is applied here in JS against each task's
  // *effective* due date (manual dueDate, or startedAt+slaDays), not at the
  // DB level — a DB-level filter could only ever see the manual-dueDate
  // half of that. Safe to do in memory: `rawTasks` is already the bounded,
  // opted-in subset above, never the full Task table.
  const tasks =
    fromFilter || toFilter
      ? rawTasks.filter((t) => {
          const due = effectiveDue(t);
          if (!due) return false;
          const dueKey = toIstDateKey(due);
          if (fromFilter && dueKey < fromFilter) return false;
          if (toFilter && dueKey > toFilter) return false;
          return true;
        })
      : rawTasks;

  const delayInputs: DelaySummaryTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    module: t.module,
    lifecycleStage: t.lifecycleStage,
    status: t.status,
    dueDate: t.dueDate,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    slaDays: t.slaDays,
    ownerName: t.owner.name,
  }));

  const summary = summarizeDelays(delayInputs);

  // Portfolio "most late" needs the store name too, which the generic
  // DelaySummaryTask shape doesn't carry — computed directly here instead
  // of reusing summary.topLate.
  const topLate = tasks
    .map((t) => ({ ...t, timing: getTaskTiming(t) }))
    .filter((t): t is typeof t & { timing: { kind: "OVERDUE"; dueDate: Date; daysOverdue: number } } =>
      t.timing.kind === "OVERDUE"
    )
    .sort((a, b) => b.timing.daysOverdue - a.timing.daysOverdue)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delays"
        subtitle="Which department or store is holding things up right now, and for how many days (plan.md section 24 — tracked milestone tasks only)."
        isFranchisee={false}
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="project">
            Store
          </label>
          <select
            id="project"
            name="project"
            defaultValue={projectFilter}
            className="block h-9 w-56 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All stores</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {formatProjectCode(p.seq)} — {p.brand}, {p.location}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="stage">
            Stage
          </label>
          <select
            id="stage"
            name="stage"
            defaultValue={stageFilter}
            className="block h-9 w-48 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All stages</option>
            {LIFECYCLE_STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {LIFECYCLE_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="from">
            Due from
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={fromFilter}
            className="block h-9 w-40 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="to">
            Due to
          </label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={toFilter}
            className="block h-9 w-40 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Apply filters
        </Button>
        {(projectFilter || stageFilter || fromFilter || toFilter) && (
          <Link href="/delays" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Running On Time" value={summary.runningOnTrack} captionClassName="text-emerald-600" />
        <StatCard
          label="Running Overdue"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Late days by department</CardTitle>
          <p className="text-xs text-muted-foreground">
            Tasks currently waiting on the franchisee are bucketed separately, not charged to an internal team.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Department</TableHead>
                <TableHead>Overdue tasks</TableHead>
                <TableHead>Total days late</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byDepartment.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Nothing overdue right now.
                  </TableCell>
                </TableRow>
              ) : (
                summary.byDepartment.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell className="text-sm">{DEPARTMENT_LABELS[b.key]}</TableCell>
                    <TableCell className="text-sm">{b.count}</TableCell>
                    <TableCell className="text-sm">{b.totalDaysOverdue}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Late days by stage</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Stage</TableHead>
                <TableHead>Overdue tasks</TableHead>
                <TableHead>Total days late</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byStage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Nothing overdue right now.
                  </TableCell>
                </TableRow>
              ) : (
                summary.byStage.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell className="text-sm">{LIFECYCLE_STAGE_LABELS[b.key]}</TableCell>
                    <TableCell className="text-sm">{b.count}</TableCell>
                    <TableCell className="text-sm">{b.totalDaysOverdue}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most overdue tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Store</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Days late</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topLate.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Nothing overdue right now.
                  </TableCell>
                </TableRow>
              ) : (
                topLate.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">
                      {formatProjectCode(t.project.seq)} — {t.project.brand}, {t.project.location}
                    </TableCell>
                    <TableCell className="text-sm">{t.title}</TableCell>
                    <TableCell className="text-sm">{DEPARTMENT_LABELS[t.module]}</TableCell>
                    <TableCell className="text-sm">{t.owner.name}</TableCell>
                    <TableCell className="text-sm font-medium text-red-600">{t.timing.daysOverdue}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
