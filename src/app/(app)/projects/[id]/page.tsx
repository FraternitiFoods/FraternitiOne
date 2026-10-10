import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canActOnComplaint,
  canActOnDocument,
  canActOnTask,
  canDeleteProject,
  canEditProjectHeader,
  canManageComplaintCategory,
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
import { getTaskTiming, formatTaskTimingBadge, summarizeDelays } from "@/lib/task-timing";
import { DelaySummaryCard } from "./delay-summary-card";
import { ProjectHeaderForm } from "./project-header-form";
import { NewTaskForm } from "./new-task-form";
import { TaskList } from "./task-list";
import { StageTile } from "./stage-tile";
import { CategoryTile } from "./category-tile";
import { DocumentUploadForm } from "./document-upload-form";
import { DocumentList } from "./document-list";
import { DeleteProjectButton } from "./delete-project-button";
import { ComplaintList } from "@/app/(app)/complaints/complaint-list";
import { NewComplaintForm } from "@/app/(app)/complaints/new-complaint-form";

// Raised from Vercel's unconfigured default: createDocument/
// createDocumentVersion/createComplaint's after() callbacks call a real
// malware scanner (src/lib/malware-scan), a third-party HTTP request with
// its own 15s internal timeout — this must stay comfortably above that so
// the serverless invocation doesn't get killed mid-scan. Server Action
// timeouts are configured at the page level (Next.js maxDuration docs), not
// in actions.ts itself.
export const maxDuration = 20;

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
          documents: {
            select: { id: true, fileName: true, fileSize: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { comments: true } },
        },
        orderBy: [{ lifecycleStage: "asc" }, { order: "asc" }],
      },
      documents: {
        include: { owner: { select: { name: true } } },
        orderBy: [{ category: "asc" }, { createdAt: "desc" }],
      },
      complaints: {
        include: {
          raisedBy: { select: { name: true } },
          assignedTo: { select: { id: true, name: true } },
          comments: {
            include: { author: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
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
  const openComplaints = project.complaints.filter(
    (c) => c.status !== "RESOLVED" && c.status !== "CLOSED"
  ).length;
  const boqProgress = computeCategoryProgress(project.tasks, "BOQ");
  const opsProgress = computeCategoryProgress(project.tasks, "OPS");

  // plan.md section 24 S3 — only tasks that are actually tracked (manual due
  // date or an SLA) ever enter a delay number (rule 1); everything else is
  // excluded here, at the source, rather than filtered out downstream.
  const delaySummary = summarizeDelays(
    project.tasks
      .filter((t) => t.status !== "CANCELLED" && (t.dueDate !== null || t.slaDays !== null))
      .map((t) => ({
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
      }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.brand} — ${project.location}`}
        subtitle={
          <>
            {formatProjectCode(project.seq)} · {project.format} · Franchisee: {project.franchisee.name} (
            {project.franchisee.email ?? "no email on file"})
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

      <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-lg bg-card px-2 py-1.5 ring-1 ring-foreground/10">
        <a
          href="#overview"
          className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Overview
        </a>
        <a
          href="#tasks"
          className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Tasks
        </a>
        <a
          href="#documents"
          className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Documents
        </a>
        <a
          href="#complaints"
          className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Complaints
        </a>
      </nav>

      <div id="overview" className="grid scroll-mt-16 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        <StatCard
          label="Open Complaints"
          value={openComplaints}
          caption={openComplaints > 0 ? "Need attention" : "All clear"}
          captionClassName={openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Franchise Lifecycle</CardTitle>
          <p className="text-xs text-muted-foreground">Your complete journey from LOI to launch</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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

      <DelaySummaryCard summary={delaySummary} isFranchisee={user.role === "FRANCHISEE"} />

      {boqProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">BOQ</CardTitle>
            <p className="text-xs text-muted-foreground">
              How far each trade has reached, rolled up from the BOQ checklist
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {boqProgress.map((c) => (
                <CategoryTile
                  key={c.category}
                  category={c.category}
                  total={c.total}
                  completed={c.completed}
                  state={c.state}
                  projectId={project.id}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {opsProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations</CardTitle>
            <p className="text-xs text-muted-foreground">
              How far each department has reached, rolled up from the Ops checklist
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {opsProgress.map((c) => (
                <CategoryTile
                  key={c.category}
                  category={c.category}
                  total={c.total}
                  completed={c.completed}
                  state={c.state}
                  projectId={project.id}
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
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
              <dt className="text-muted-foreground">Target opening</dt>
              <dd className="sm:col-span-3">{formatDate(project.targetOpening)}</dd>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="sm:col-span-3">{project.owner.name}</dd>
              <dt className="text-muted-foreground">Next action</dt>
              <dd className="sm:col-span-3">{project.nextAction ?? "—"}</dd>
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
            commentCount: task._count.comments,
            documents: task.documents.map((d) => ({
              id: d.id,
              fileName: d.fileName,
              fileSize: d.fileSize,
              createdAt: d.createdAt.toISOString(),
            })),
            timingBadge: formatTaskTimingBadge(getTaskTiming(task)),
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

        <DocumentList
          projectId={project.id}
          documents={project.documents.map((document) => ({
            id: document.id,
            category: document.category,
            title: document.title,
            version: document.version,
            status: document.status,
            fileName: document.fileName,
            fileSize: document.fileSize,
            createdAt: document.createdAt.toISOString(),
            owner: document.owner,
            canAct: canActOnDocument(user, document, project),
          }))}
        />

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

      <div id="complaints" className="scroll-mt-16 space-y-4">
        <h2 className="text-lg font-semibold">Complaints</h2>

        <ComplaintList
          complaints={project.complaints.map((complaint) => ({
            id: complaint.id,
            seq: complaint.seq,
            category: complaint.category,
            subject: complaint.subject,
            description: complaint.description,
            priority: complaint.priority,
            status: complaint.status,
            raisedBy: complaint.raisedBy,
            assignedTo: complaint.assignedTo,
            attachmentFileName: complaint.attachmentFileName,
            resolutionDate: complaint.resolutionDate ? complaint.resolutionDate.toISOString() : null,
            createdAt: complaint.createdAt.toISOString(),
            comments: complaint.comments.map((c) => ({
              id: c.id,
              body: c.body,
              createdAt: c.createdAt.toISOString(),
              author: c.author,
            })),
            projectId: project.id,
            canAct: canActOnComplaint(user, complaint, project),
            canAssign: canManageComplaintCategory(user, complaint.category),
          }))}
          people={people}
        />

        <Separator />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raise a complaint</CardTitle>
          </CardHeader>
          <CardContent>
            <NewComplaintForm projectId={project.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
