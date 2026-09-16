import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "cn";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnTask, canEditProjectHeader, canViewProject, getManageableModules } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  daysUntil,
  formatDate,
  formatProjectCode,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_ORDER,
  PROJECT_HEALTH_LABELS,
} from "@/lib/format";
import { HEALTH_BADGE_CLASS } from "@/lib/badge-colors";
import { ProjectHeaderForm } from "./project-header-form";
import { NewTaskForm } from "./new-task-form";
import { TaskCard } from "./task-card";

export default async function ProjectDetailPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();

  const project = await db.franchiseProject.findUnique({
    where: { id },
    include: {
      franchisee: { select: { id: true, name: true, email: true } },
      owner: { select: { id: true, name: true } },
      tasks: {
        include: {
          owner: { select: { name: true } },
          createdBy: { select: { name: true } },
          dependsOn: { select: { title: true } },
          comments: {
            include: { author: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!project || !canViewProject(user, project)) {
    notFound();
  }

  const [people] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const manageableModules = getManageableModules(user);

  const total = project.tasks.length;
  const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const openTasks = total - completed;
  const daysToLaunch = daysUntil(project.targetOpening);
  const currentStageIndex = LIFECYCLE_STAGE_ORDER.indexOf(project.lifecycleStage);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.brand} — ${project.location}`}
        subtitle={
          <>
            {formatProjectCode(project.seq)} · {project.format} · Franchisee: {project.franchisee.name} (
            {project.franchisee.email})
          </>
        }
        isFranchisee={user.role === "FRANCHISEE"}
        action={
          <Link href={`/audit?project=${project.id}`} className="text-sm underline underline-offset-4">
            Audit trail →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Site Progress" value={`${progressPct}%`} caption={`${completed}/${total} tasks done`} />
        <StatCard
          label="Open Tasks"
          value={openTasks}
          caption={openTasks > 0 ? "Need attention" : "All clear"}
          captionClassName={openTasks > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <StatCard
          label="Days to Launch"
          value={Math.abs(daysToLaunch)}
          caption={daysToLaunch >= 0 ? `Target ${formatDate(project.targetOpening)}` : "Past target opening"}
          captionClassName={daysToLaunch >= 0 ? "text-blue-600" : "text-red-600"}
        />
        <StatCard
          label="Health"
          value={PROJECT_HEALTH_LABELS[project.health]}
          caption={project.nextAction ?? "No next action set"}
          captionClassName={
            project.health === "GREEN"
              ? "text-emerald-600"
              : project.health === "AMBER"
                ? "text-amber-600"
                : "text-red-600"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Franchise Lifecycle</CardTitle>
          <p className="text-xs text-muted-foreground">Your complete journey from LOI to launch</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {LIFECYCLE_STAGE_ORDER.map((stage, index) => {
              const state =
                index < currentStageIndex
                  ? "completed"
                  : index === currentStageIndex
                    ? "current"
                    : "upcoming";
              return (
                <div
                  key={stage}
                  className={cn(
                    "rounded-lg border p-3",
                    state === "completed" && "border-emerald-200 bg-emerald-50",
                    state === "current" && "border-primary/30 bg-primary/5",
                    state === "upcoming" && "border-border bg-background"
                  )}
                >
                  <div className="text-xs font-medium text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-1 text-sm font-medium">{LIFECYCLE_STAGE_LABELS[stage]}</div>
                  <div
                    className={cn(
                      "mt-1 text-xs",
                      state === "completed" && "text-emerald-700",
                      state === "current" && "text-primary",
                      state === "upcoming" && "text-muted-foreground"
                    )}
                  >
                    {state === "completed" ? "Completed" : state === "current" ? "In Progress" : "Upcoming"}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle & status (FR-002)</CardTitle>
        </CardHeader>
        <CardContent>
          {canEditProjectHeader(user) ? (
            <ProjectHeaderForm
              projectId={project.id}
              lifecycleStage={project.lifecycleStage}
              health={project.health}
              nextAction={project.nextAction}
              targetOpening={project.targetOpening.toISOString().slice(0, 10)}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
              <dt className="text-muted-foreground">Stage</dt>
              <dd className="col-span-3">{LIFECYCLE_STAGE_LABELS[project.lifecycleStage]}</dd>
              <dt className="text-muted-foreground">Target opening</dt>
              <dd className="col-span-3">{formatDate(project.targetOpening)}</dd>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="col-span-3">{project.owner.name}</dd>
              <dt className="text-muted-foreground">Next action</dt>
              <dd className="col-span-3">{project.nextAction ?? "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tasks (FR-003)</h2>
          <Badge variant="outline" className={HEALTH_BADGE_CLASS[project.health]}>
            {PROJECT_HEALTH_LABELS[project.health]}
          </Badge>
        </div>

        {project.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <div className="space-y-3">
            {project.tasks.map((task) => (
              <TaskCard
                key={task.id}
                projectId={project.id}
                canAct={canActOnTask(user, task, project)}
                task={{
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  module: task.module,
                  status: task.status,
                  priority: task.priority,
                  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
                  completionEvidence: task.completionEvidence,
                  owner: task.owner,
                  createdBy: task.createdBy,
                  dependsOn: task.dependsOn,
                  comments: task.comments.map((c) => ({
                    id: c.id,
                    body: c.body,
                    createdAt: c.createdAt.toISOString(),
                    author: c.author,
                  })),
                }}
              />
            ))}
          </div>
        )}

        {manageableModules.length > 0 && (
          <>
            <Separator />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add a task</CardTitle>
              </CardHeader>
              <CardContent>
                <NewTaskForm
                  projectId={project.id}
                  modules={manageableModules}
                  people={people}
                  existingTasks={project.tasks.map((t) => ({ id: t.id, title: t.title }))}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
