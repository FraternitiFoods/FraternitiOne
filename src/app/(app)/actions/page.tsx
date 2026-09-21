import Link from "next/link";
import { cn } from "cn";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnTask } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ActionsList, type ActionItem } from "./actions-list";
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
export default async function ActionsPage(props: PageProps<"/actions">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const selectedProjectId = typeof projectParam === "string" ? projectParam : undefined;

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
  const myOpenTasksAll = openTasks.filter((t) => canActOnTask(user, t, t.project));
  const myCompletedThisWeekAll = completedThisWeek.filter((t) => canActOnTask(user, t, t.project));

  // Franchise picker (2026-09-21, Apoorv's ask: "pehle choose krne ka option
  // ki konsi franchise ka dekhna hai") — built from every franchise that has
  // an open task for this user, regardless of the current ?project=
  // selection, so switching franchises from the picker always stays
  // possible. Skipped entirely for a franchisee (always exactly their own
  // one project) or anyone else with only one project in view.
  const projectCardMap = new Map<
    string,
    { id: string; brand: string; location: string; count: number }
  >();
  for (const t of myOpenTasksAll) {
    const existing = projectCardMap.get(t.project.id);
    if (existing) {
      existing.count += 1;
    } else {
      projectCardMap.set(t.project.id, {
        id: t.project.id,
        brand: t.project.brand,
        location: t.project.location,
        count: 1,
      });
    }
  }
  const projectCards = Array.from(projectCardMap.values()).sort((a, b) =>
    a.brand === b.brand ? a.location.localeCompare(b.location) : a.brand.localeCompare(b.brand)
  );
  const selectedProject = selectedProjectId
    ? projectCards.find((p) => p.id === selectedProjectId)
    : undefined;

  const myOpenTasks = selectedProjectId
    ? myOpenTasksAll.filter((t) => t.projectId === selectedProjectId)
    : myOpenTasksAll;
  const myCompletedThisWeek = selectedProjectId
    ? myCompletedThisWeekAll.filter((t) => t.projectId === selectedProjectId)
    : myCompletedThisWeekAll;

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

  const items: ActionItem[] = sorted.map((task) => ({
    id: task.id,
    title: task.title,
    module: task.module,
    category: task.category,
    lifecycleStage: task.lifecycleStage,
    projectId: task.projectId,
    projectSeq: task.project.seq,
    projectBrand: task.project.brand,
    projectLocation: task.project.location,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    overdue: overdueIds.has(task.id),
    priority: task.priority,
    status: task.status,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Action Centre"
        subtitle={
          selectedProject
            ? `Scoped to ${selectedProject.brand} — ${selectedProject.location}. Everything needing your attention, sorted by urgency.`
            : "Everything needing your attention, sorted by urgency (FR-004 placeholder — approvals/payments queues arrive in Phase 2)."
        }
        isFranchisee={user.role === "FRANCHISEE"}
      />

      {projectCards.length > 1 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Franchise</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/actions"
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                !selectedProjectId
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted/40"
              )}
            >
              All Franchises
              <span className="ml-1.5 text-xs text-muted-foreground">({myOpenTasksAll.length})</span>
            </Link>
            {projectCards.map((p) => (
              <Link
                key={p.id}
                href={`/actions?project=${p.id}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm transition-colors",
                  selectedProjectId === p.id
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-muted/40"
                )}
              >
                {p.brand} — {p.location}
                <span className="ml-1.5 text-xs text-muted-foreground">({p.count})</span>
              </Link>
            ))}
          </div>
        </div>
      )}

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

      <ActionsList items={items} />
    </div>
  );
}
