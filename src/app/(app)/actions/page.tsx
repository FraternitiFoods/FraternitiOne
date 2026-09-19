import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnTask } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DEPARTMENT_LABELS,
  LIFECYCLE_STAGE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatProjectCode,
} from "@/lib/format";
import { TASK_PRIORITY_BADGE_CLASS, TASK_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { Prisma, TaskPriority } from "@prisma/client";

// Plain module-level helpers (not inline in the component body) so the
// `Date.now()` call doesn't trip eslint-plugin-react-hooks' purity rule for
// Server Components — same pattern as `daysUntil` in format.ts.
function sevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
function isOverdue(dueDate: Date): boolean {
  return dueDate.getTime() < Date.now();
}

/**
 * FR-004 placeholder (plan.md section 2: "Phase 1 only needs a placeholder
 * list view in Action Centre, not the approve/reject engine"). There is no
 * Approval/Payment entity yet (both Phase 2), so this reads the one
 * actionable-item type Phase 1 actually has — Task — and surfaces "what do
 * I need to do next" (SRD north-star question) across every project this
 * user can act on. Read-only: it links out to the existing stage page for
 * any actual status change rather than duplicating that UI here.
 */
export default async function ActionsPage() {
  const user = await requireUser();

  // Same project-level isolation as everywhere else (NFR-04): a franchisee
  // only ever sees their own project's tasks.
  const projectScope: Prisma.TaskWhereInput =
    user.role === "FRANCHISEE" ? { project: { franchiseeId: user.id } } : {};

  const projectInclude = {
    select: { id: true, seq: true, brand: true, location: true, franchiseeId: true },
  } as const;

  const [openTasks, completedThisWeek] = await Promise.all([
    db.task.findMany({
      where: { ...projectScope, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      include: { project: projectInclude },
      orderBy: { dueDate: "asc" },
    }),
    db.task.findMany({
      where: {
        ...projectScope,
        status: "COMPLETED",
        completedAt: { gte: sevenDaysAgo() },
      },
      include: { project: projectInclude },
    }),
  ]);

  // Task/project shape from the queries above satisfies canActOnTask's
  // (narrower) parameter types directly.
  const myOpenTasks = openTasks.filter((t) => canActOnTask(user, t, t.project));
  const myCompletedThisWeek = completedThisWeek.filter((t) => canActOnTask(user, t, t.project));

  const overdue = myOpenTasks.filter((t) => t.dueDate && isOverdue(t.dueDate));
  const critical = myOpenTasks.filter((t) => t.priority === "CRITICAL");
  // "The ball is in this user's court" — the status that means this specific
  // audience (franchisee vs. every internal role) is the one being waited on.
  const awaitingYouStatus = user.role === "FRANCHISEE" ? "AWAITING_FRANCHISEE" : "AWAITING_INTERNAL";
  const awaitingYou = myOpenTasks.filter((t) => t.status === awaitingYouStatus);

  const overdueIds = new Set(overdue.map((t) => t.id));
  const priorityRank: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...myOpenTasks].sort((a, b) => {
    const aOverdue = overdueIds.has(a.id) ? 0 : 1;
    const bOverdue = overdueIds.has(b.id) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const rankDiff = priorityRank[a.priority] - priorityRank[b.priority];
    if (rankDiff !== 0) return rankDiff;
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Action Centre"
        subtitle="Everything needing your attention, sorted by urgency (FR-004 placeholder — approvals/payments queues arrive in Phase 2)."
        isFranchisee={user.role === "FRANCHISEE"}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Critical"
          value={critical.length}
          caption="Critical priority, open"
          captionClassName={critical.length > 0 ? "text-red-600" : undefined}
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          caption="Past due date"
          captionClassName={overdue.length > 0 ? "text-red-600" : undefined}
        />
        <StatCard
          label="Awaiting You"
          value={awaitingYou.length}
          caption={user.role === "FRANCHISEE" ? "Needs your decision" : "Needs internal action"}
          captionClassName={awaitingYou.length > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          label="Completed This Week"
          value={myCompletedThisWeek.length}
          caption="Last 7 days"
          captionClassName="text-emerald-600"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          ) : (
            <div className="divide-y">
              {sorted.map((task) => (
                <Link
                  key={task.id}
                  href={`/projects/${task.projectId}/stages/${task.lifecycleStage}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      <Badge variant="outline">{DEPARTMENT_LABELS[task.module]}</Badge>
                      <Badge variant="outline">{LIFECYCLE_STAGE_LABELS[task.lifecycleStage]}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatProjectCode(task.project.seq)} — {task.project.brand}, {task.project.location}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {task.dueDate && (
                      <span className={overdueIds.has(task.id) ? "text-xs font-medium text-red-600" : "text-xs text-muted-foreground"}>
                        Due {formatDate(task.dueDate)}
                      </span>
                    )}
                    <Badge variant="outline" className={TASK_PRIORITY_BADGE_CLASS[task.priority]}>
                      {TASK_PRIORITY_LABELS[task.priority]}
                    </Badge>
                    <Badge variant="outline" className={TASK_STATUS_BADGE_CLASS[task.status]}>
                      {TASK_STATUS_LABELS[task.status]}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
