import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnTask, canViewProject } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { formatProjectCode } from "@/lib/format";
import { computeStageStatus, STAGE_STATE_LABELS } from "@/lib/lifecycle-stage-status";
import { TaskCard } from "../../task-card";

export default async function CategoryDetailPage(
  props: PageProps<"/projects/[id]/categories/[category]">
) {
  const { id, category: categoryParam } = await props.params;
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const category = decodeURIComponent(categoryParam);

  // Where "← Back" goes, and where actions on this page redirect back to —
  // defaults to the project page (tile lives there too), but the /progress
  // screen's tiles pass their own URL through so tapping a card there and
  // then going back lands you back on /progress, not the project page.
  const backParam = searchParams.back;
  const backHref = typeof backParam === "string" ? backParam : `/projects/${id}`;
  const selfHref = `/projects/${id}/categories/${encodeURIComponent(category)}${
    typeof backParam === "string" ? `?back=${encodeURIComponent(backParam)}` : ""
  }`;

  const project = await db.franchiseProject.findUnique({
    where: { id },
    include: {
      tasks: {
        where: { category },
        include: {
          owner: { select: { name: true } },
          createdBy: { select: { name: true } },
          dependsOn: { select: { title: true } },
          comments: {
            include: { author: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
          documents: {
            select: { id: true, fileName: true, fileSize: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!project || !canViewProject(user, project) || project.tasks.length === 0) {
    notFound();
  }

  const status = computeStageStatus(project.tasks, false);
  const total = project.tasks.length;
  const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={backHref}
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        ← Back
      </Link>

      <PageHeader
        title={category}
        subtitle={`Trade/department · ${formatProjectCode(project.seq)}`}
        isFranchisee={user.role === "FRANCHISEE"}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <div className="text-sm font-medium">{STAGE_STATE_LABELS[status]}</div>
            <div className="text-xs text-muted-foreground">
              {completed}/{total} tasks completed
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {project.tasks.map((task) => (
          <TaskCard
            key={task.id}
            projectId={project.id}
            canAct={canActOnTask(user, task, project)}
            returnPath={selfHref}
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
              documents: task.documents.map((d) => ({
                id: d.id,
                fileName: d.fileName,
                fileSize: d.fileSize,
                createdAt: d.createdAt.toISOString(),
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
