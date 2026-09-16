import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnTask, canEditProjectHeader, canViewProject, getManageableModules } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatDate,
  formatProjectCode,
  LIFECYCLE_STAGE_LABELS,
  PROJECT_HEALTH_LABELS,
} from "@/lib/format";
import { ProjectHeaderForm } from "./project-header-form";
import { NewTaskForm } from "./new-task-form";
import { TaskCard } from "./task-card";
import type { ProjectHealth } from "@prisma/client";

const HEALTH_BADGE_VARIANT: Record<ProjectHealth, "default" | "secondary" | "destructive"> = {
  GREEN: "secondary",
  AMBER: "default",
  RED: "destructive",
  CRITICAL: "destructive",
};

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

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{formatProjectCode(project.seq)}</p>
          <h1 className="text-2xl font-semibold">
            {project.brand} — {project.location}
          </h1>
          <p className="text-sm text-muted-foreground">
            {project.format} · Franchisee: {project.franchisee.name} ({project.franchisee.email})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={HEALTH_BADGE_VARIANT[project.health]}>
            {PROJECT_HEALTH_LABELS[project.health]}
          </Badge>
          <Link href={`/audit?project=${project.id}`} className="text-sm underline underline-offset-4">
            Audit trail →
          </Link>
        </div>
      </div>

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
