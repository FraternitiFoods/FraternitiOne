import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEPARTMENT_LABELS,
  daysUntil,
  formatDate,
  formatDateTime,
  formatProjectCode,
  humanize,
  PROJECT_HEALTH_LABELS,
  splitPascalCase,
} from "@/lib/format";
import type { Department, TaskStatus } from "@prisma/client";

// FR-002: lifecycle stage, progress %, target opening, owner, next action —
// rendered differently per role: franchisees get a single-project "Franchise
// Home Dashboard" (SRD wireframe 01), everyone else gets a portfolio pulse
// (SRD wireframe 19, "Management Command Centre") since internal staff work
// across projects, not inside just one (permissions.ts: canViewProject).
export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role === "FRANCHISEE") {
    return <FranchiseeDashboard franchiseeId={user.id} />;
  }
  return <InternalDashboard />;
}

async function FranchiseeDashboard({ franchiseeId }: { franchiseeId: string }) {
  const projects = await db.franchiseProject.findMany({
    where: { franchiseeId },
    include: {
      tasks: { select: { status: true, module: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="Franchise Home Dashboard" isFranchisee />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No franchise project is linked to your account yet.
          </CardContent>
        </Card>
      </div>
    );
  }

  // FR-001 means one franchisee normally has exactly one Project ID; if more
  // than one somehow exists, the home dashboard shows the most recent and
  // links out to the rest.
  const project = projects[0];

  const total = project.tasks.length;
  const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;
  // Task-completion-ratio placeholder for "progress %" (FR-002) — the SRD's
  // real formula (section 9) is milestone-weighted and needs the Milestone
  // entity, which is Phase 2+ (plan.md section 2).
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const openTasks = total - completed;
  const daysToLaunch = daysUntil(project.targetOpening);

  const moduleProgress = computeModuleProgress(project.tasks);

  const recentEvents = await db.auditEvent.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Franchise Home Dashboard"
        subtitle={`${project.brand} · ${project.location} | ${formatProjectCode(project.seq)}`}
        isFranchisee
        action={
          projects.length > 1 ? (
            <Link href="/projects" className="text-sm underline underline-offset-4">
              View all {projects.length} projects →
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 py-5">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Your restaurant is
            </p>
            <p className="text-4xl font-bold">
              {progressPct}% <span className="text-primary">Ready</span>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Target Opening:{" "}
            <span className="font-medium text-foreground">{formatDate(project.targetOpening)}</span>
          </p>
          <div className="h-2 w-full basis-full rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Action Required"
          value={openTasks}
          caption={openTasks > 0 ? "Tasks need attention" : "All caught up"}
          captionClassName={openTasks > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <StatCard label="Tasks Completed" value={`${completed}/${total}`} caption="Across all modules" />
        <StatCard
          label="Opening Readiness"
          value={`${progressPct}%`}
          caption={PROJECT_HEALTH_LABELS[project.health]}
          captionClassName={
            project.health === "GREEN"
              ? "text-emerald-600"
              : project.health === "AMBER"
                ? "text-amber-600"
                : "text-red-600"
          }
        />
        <StatCard
          label="Days to Launch"
          value={Math.abs(daysToLaunch)}
          caption={daysToLaunch >= 0 ? "On target" : "Past target opening"}
          captionClassName={daysToLaunch >= 0 ? "text-blue-600" : "text-red-600"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lifecycle Progress</CardTitle>
            <p className="text-xs text-muted-foreground">One continuous franchise journey</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {moduleProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              moduleProgress.map((m) => (
                <div key={m.module}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{DEPARTMENT_LABELS[m.module]}</span>
                    <span className="text-muted-foreground">{m.pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                    <div className={progressBarClass(m.pct)} style={{ width: `${m.pct}%` }} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest Updates</CardTitle>
            <p className="text-xs text-muted-foreground">Live from your project</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              recentEvents.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">{formatDateTime(e.createdAt)}</div>
                    <div className="font-medium">
                      {humanize(e.action)} — {splitPascalCase(e.entityType)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {splitPascalCase(e.entityType)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {project.nextAction && (
        <Card>
          <CardContent className="py-4 text-sm">
            <span className="font-medium">Next action: </span>
            {project.nextAction}
          </CardContent>
        </Card>
      )}

      <div className="text-right">
        <Link href={`/projects/${project.id}`} className="text-sm underline underline-offset-4">
          Open full project detail →
        </Link>
      </div>
    </div>
  );
}

async function InternalDashboard() {
  const projects = await db.franchiseProject.findMany({
    select: { health: true },
  });

  const counts = {
    total: projects.length,
    onTrack: projects.filter((p) => p.health === "GREEN").length,
    atRisk: projects.filter((p) => p.health === "AMBER").length,
    critical: projects.filter((p) => p.health === "RED" || p.health === "CRITICAL").length,
  };

  const recentEvents = await db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { project: { select: { seq: true, brand: true, location: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Management Command Centre"
        subtitle="Portfolio-wide pulse across all franchises"
        isFranchisee={false}
        action={
          <Link href="/projects" className="text-sm underline underline-offset-4">
            View full project list →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Projects" value={counts.total} caption="All lifecycle stages" />
        <StatCard
          label="On Track"
          value={counts.onTrack}
          caption="Green health"
          captionClassName="text-emerald-600"
        />
        <StatCard
          label="At Risk"
          value={counts.atRisk}
          caption="Needs action"
          captionClassName="text-amber-600"
        />
        <StatCard
          label="Critical"
          value={counts.critical}
          caption="Escalated"
          captionClassName="text-red-600"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Department Feed</CardTitle>
          <p className="text-xs text-muted-foreground">
            Real-time operational reporting across project departments
          </p>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="divide-y">
              {recentEvents.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-36 shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </span>
                    <span className="font-medium">
                      {e.project ? `${e.project.brand} — ${e.project.location}` : "—"}
                    </span>
                    <Badge variant="outline">{splitPascalCase(e.entityType)}</Badge>
                    <span className="text-muted-foreground">{humanize(e.action)}</span>
                  </div>
                  {e.project && (
                    <Link href={`/projects/${e.projectId}`} className="text-xs underline underline-offset-4">
                      {formatProjectCode(e.project.seq)}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function computeModuleProgress(tasks: { status: TaskStatus; module: Department }[]) {
  const byModule = new Map<Department, { total: number; completed: number }>();
  for (const t of tasks) {
    const entry = byModule.get(t.module) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (t.status === "COMPLETED") entry.completed += 1;
    byModule.set(t.module, entry);
  }
  return Array.from(byModule.entries())
    .map(([module, { total, completed }]) => ({
      module,
      pct: total === 0 ? 0 : Math.round((completed / total) * 100),
    }))
    .sort((a, b) => b.pct - a.pct);
}

function progressBarClass(pct: number): string {
  const base = "h-1.5 rounded-full";
  if (pct >= 100) return `${base} bg-emerald-500`;
  if (pct >= 50) return `${base} bg-primary`;
  if (pct > 0) return `${base} bg-amber-500`;
  return `${base} bg-slate-300`;
}
