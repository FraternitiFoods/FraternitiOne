import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canActOnDocument,
  canActOnTask,
  canDeleteProject,
  canEditProjectHeader,
  canViewProject,
  getManageableModules,
} from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  daysUntil,
  formatDate,
  formatProjectCode,
  LIFECYCLE_STAGE_ORDER,
  PROJECT_HEALTH_LABELS,
} from "@/lib/format";
import { computeStageStatus } from "@/lib/lifecycle-stage-status";
import { computeCategoryProgress } from "@/lib/category-progress";
import { HEALTH_BADGE_CLASS } from "@/lib/badge-colors";
import { ProjectHeaderForm } from "./project-header-form";
import { NewTaskForm } from "./new-task-form";
import { TaskList } from "./task-list";
import { StageTile } from "./stage-tile";
import { CategoryTile } from "./category-tile";
import { DocumentUploadForm } from "./document-upload-form";
import { DocumentCard } from "./document-card";
import { DeleteProjectButton } from "./delete-project-button";

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
        orderBy: [{ lifecycleStage: "asc" }, { order: "asc" }],
      },
      documents: {
        include: { owner: { select: { name: true } } },
        orderBy: [{ category: "asc" }, { createdAt: "desc" }],
      },
      stageOverrides: true,
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
  const overriddenStages = new Set(project.stageOverrides.map((o) => o.stage));
  const categoryProgress = computeCategoryProgress(project.tasks);

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
          <>
            <Link href={`/audit?project=${project.id}`} className="text-sm underline underline-offset-4">
              Audit trail →
            </Link>
            {canDeleteProject(user) && (
              <DeleteProjectButton projectId={project.id} brand={project.brand} location={project.location} />
            )}
          </>
        }
      />

      <nav className="sticky top-0 z-10 flex gap-1 rounded-lg bg-card px-2 py-1.5 ring-1 ring-foreground/10">
        <a
          href="#overview"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Overview
        </a>
        <a
          href="#tasks"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Tasks
        </a>
        <a
          href="#documents"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Documents
        </a>
      </nav>

      <div id="overview" className="grid scroll-mt-16 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              const stageTasks = project.tasks.filter((t) => t.lifecycleStage === stage);
              const isOverridden = overriddenStages.has(stage);
              const stageCompleted = stageTasks.filter((t) => t.status === "COMPLETED").length;
              return (
                <StageTile
                  key={stage}
                  stage={stage}
                  index={index}
                  status={computeStageStatus(stageTasks, isOverridden)}
                  isOverridden={isOverridden}
                  projectId={project.id}
                  total={stageTasks.length}
                  completed={stageCompleted}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {categoryProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Construction &amp; Ops Progress</CardTitle>
            <p className="text-xs text-muted-foreground">
              How far each trade/department has reached, rolled up from the BOQ/Ops checklist
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {categoryProgress.map((c) => (
                <CategoryTile
                  key={c.category}
                  category={c.category}
                  total={c.total}
                  completed={c.completed}
                  state={c.state}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project status (FR-002)</CardTitle>
        </CardHeader>
        <CardContent>
          {canEditProjectHeader(user) ? (
            <ProjectHeaderForm
              projectId={project.id}
              health={project.health}
              nextAction={project.nextAction}
              targetOpening={project.targetOpening.toISOString().slice(0, 10)}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
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

      <div id="tasks" className="scroll-mt-16 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tasks (FR-003)</h2>
          <Badge variant="outline" className={HEALTH_BADGE_CLASS[project.health]}>
            {PROJECT_HEALTH_LABELS[project.health]}
          </Badge>
        </div>

        <TaskList
          projectId={project.id}
          tasks={project.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            module: task.module,
            category: task.category,
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
            canAct: canActOnTask(user, task, project),
          }))}
        />

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

      <div id="documents" className="scroll-mt-16 space-y-4">
        <h2 className="text-lg font-semibold">Documents (FR-005)</h2>

        {project.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <div className="space-y-3">
            {project.documents.map((document) => (
              <DocumentCard
                key={document.id}
                projectId={project.id}
                canAct={canActOnDocument(user, document, project)}
                document={{
                  id: document.id,
                  category: document.category,
                  title: document.title,
                  version: document.version,
                  status: document.status,
                  fileName: document.fileName,
                  fileSize: document.fileSize,
                  createdAt: document.createdAt.toISOString(),
                  owner: document.owner,
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
                <CardTitle className="text-base">Upload a document</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentUploadForm projectId={project.id} categories={manageableModules} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
