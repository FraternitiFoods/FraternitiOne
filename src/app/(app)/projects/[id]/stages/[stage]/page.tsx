import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canActOnTask,
  canForceCompleteStage,
  canViewProject,
  getManageableModules,
} from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_ORDER, formatProjectCode } from "@/lib/format";
import { computeStageStatus, STAGE_STATE_LABELS } from "@/lib/lifecycle-stage-status";
import { NewTaskForm } from "../../new-task-form";
import { TaskCard } from "../../task-card";
import { StageActions } from "./stage-actions";
import type { LifecycleStage } from "@prisma/client";

export default async function StageDetailPage(
  props: PageProps<"/projects/[id]/stages/[stage]">
) {
  const { id, stage: stageParam } = await props.params;
  const user = await requireUser();

  if (!LIFECYCLE_STAGE_ORDER.includes(stageParam as LifecycleStage)) {
    notFound();
  }
  const stage = stageParam as LifecycleStage;

  const project = await db.franchiseProject.findUnique({
    where: { id },
    include: {
      tasks: {
        where: { lifecycleStage: stage },
        include: {
          owner: { select: { name: true } },
          createdBy: { select: { name: true } },
          dependsOn: { select: { title: true } },
          comments: {
            include: { author: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
      stageOverrides: { where: { stage } },
    },
  });

  if (!project || !canViewProject(user, project)) {
    notFound();
  }

  const people = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const manageableModules = getManageableModules(user);
  const isOverridden = project.stageOverrides.length > 0;
  const status = computeStageStatus(project.tasks, isOverridden);
  const total = project.tasks.length;
  const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const stageIndex = LIFECYCLE_STAGE_ORDER.indexOf(stage);
  const returnPath = `/projects/${project.id}/stages/${stage}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/projects/${project.id}`}
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        ← Back to project
      </Link>

      <PageHeader
        title={LIFECYCLE_STAGE_LABELS[stage]}
        subtitle={`Stage ${String(stageIndex + 1).padStart(2, "0")} of 13 · ${formatProjectCode(project.seq)}`}
        isFranchisee={user.role === "FRANCHISEE"}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <div className="text-sm font-medium">
              {STAGE_STATE_LABELS[status]}
              {isOverridden && " (marked complete by admin)"}
            </div>
            <div className="text-xs text-muted-foreground">
              {total === 0 ? "No tasks yet." : `${completed}/${total} tasks completed`}
            </div>
          </div>
          {canForceCompleteStage(user) && (
            <StageActions projectId={project.id} stage={stage} isOverridden={isOverridden} />
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {project.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          project.tasks.map((task, i) => (
            <TaskCard
              key={task.id}
              projectId={project.id}
              canAct={canActOnTask(user, task, project)}
              reorder={{ canMoveUp: i > 0, canMoveDown: i < project.tasks.length - 1 }}
              returnPath={returnPath}
              task={{
                id: task.id,
                title: task.title,
                description: task.description,
                module: task.module,
                lifecycleStage: task.lifecycleStage,
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
          ))
        )}
      </div>

      {manageableModules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a task to this stage</CardTitle>
          </CardHeader>
          <CardContent>
            <NewTaskForm
              projectId={project.id}
              modules={manageableModules}
              people={people}
              existingTasks={project.tasks.map((t) => ({ id: t.id, title: t.title }))}
              stage={stage}
              returnPath={returnPath}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
