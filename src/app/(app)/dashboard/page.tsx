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
import { REVIEW_STATUS_LABELS, LOI_VERSION_STATUS_LABELS } from "@/lib/onboarding/format";
import { computeOnboardingCompletion } from "@/lib/onboarding/completion";
import { formatPaiseAsRupees } from "@/lib/sales/format";
import {
  getSalesThisMonth,
  getRecentEmails,
  isOpenComplaintStatus,
  OPEN_COMPLAINT_STATUS_FILTER,
} from "@/lib/dashboard/widgets";
import { RecentEmailsCard } from "@/components/recent-emails-card";
import type { Department, Role, TaskStatus } from "@prisma/client";

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
  // plan.md section 20B — SALES gets its own scoped pipeline view (today's
  // InternalDashboard has no SALES-specific branch); every other internal
  // role keeps the existing portfolio pulse, with an extra widget row for
  // ADMIN/MANAGEMENT only (see InternalDashboard's own role check below).
  if (user.role === "SALES") {
    return <SalesDashboard userId={user.id} />;
  }
  return <InternalDashboard role={user.role} />;
}

async function FranchiseeDashboard({ franchiseeId }: { franchiseeId: string }) {
  const projects = await db.franchiseProject.findMany({
    where: { franchiseeId },
    include: {
      tasks: { select: { status: true, module: true } },
      // plan.md section 20B — additive: these two relations back the new
      // widget row below (Open Complaints, Onboarding/KYC/Payment/LOI
      // status). `onboarding` is null for a project created directly via
      // /projects/new (pre-section-17 data) — every widget that depends on
      // it is skipped, not crashed, in that case.
      complaints: { select: { status: true } },
      onboarding: {
        select: {
          id: true,
          entityType: true,
          kycStatus: true,
          paymentStatus: true,
          kyc: true,
          files: { where: { supersededBy: null }, select: { kind: true } },
          currentLoiVersion: { select: { status: true } },
        },
      },
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

  // plan.md section 20B — Franchisee widget row. Every number below is a
  // fresh query/computation for this request, nothing stored or cached.
  const onboarding = project.onboarding;
  const completion = onboarding
    ? computeOnboardingCompletion({
        entityType: onboarding.entityType,
        kyc: onboarding.kyc,
        uploadedFileKinds: onboarding.files.map((f) => f.kind),
        paymentStatus: onboarding.paymentStatus,
      })
    : null;
  const openComplaints = project.complaints.filter((c) => isOpenComplaintStatus(c.status)).length;
  const [salesThisMonth, recentEmails] = await Promise.all([
    getSalesThisMonth(project.id),
    onboarding ? getRecentEmails(onboarding.id) : Promise.resolve([]),
  ]);

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

      {/* plan.md section 20B — additive widget row: onboarding/KYC/payment/
          LOI status, sales this month, open complaints, latest emails. Shown
          only when this project came from the onboarding flow (`onboarding`
          is null for pre-section-17 projects created directly via
          /projects/new) — Sales This Month and Open Complaints don't need an
          onboarding record and always render. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Onboarding & Store
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {onboarding && completion && (
            <StatCard
              label="Onboarding Completion"
              value={`${completion.completed}/${completion.total}`}
              caption="Required items submitted"
            />
          )}
          {onboarding && (
            <StatCard label="KYC Status" value={REVIEW_STATUS_LABELS[onboarding.kycStatus]} />
          )}
          {onboarding && (
            <StatCard label="Payment Status" value={REVIEW_STATUS_LABELS[onboarding.paymentStatus]} />
          )}
          {onboarding && (
            <StatCard
              label="LOI Status"
              value={
                onboarding.currentLoiVersion
                  ? LOI_VERSION_STATUS_LABELS[onboarding.currentLoiVersion.status]
                  : "Not yet generated"
              }
            />
          )}
          <StatCard
            label="Sales This Month"
            value={formatPaiseAsRupees(salesThisMonth.netSales)}
            caption={`${salesThisMonth.orders} orders · net`}
          />
          <StatCard
            label="Open Complaints"
            value={openComplaints}
            caption={openComplaints > 0 ? "Needs attention" : "All clear"}
            captionClassName={openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
          />
        </div>
      </div>

      {onboarding && (
        <RecentEmailsCard
          emails={recentEmails}
          subtitle="Most recent notifications about your onboarding"
        />
      )}

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

async function InternalDashboard({ role }: { role: Role }) {
  // plan.md section 20B — ADMIN/MANAGEMENT widget row, added alongside the
  // existing portfolio-health stat row above (not replacing it). Every
  // other internal role (LEGAL, HR, ACCOUNTS, KYC_REVIEWER, ...) keeps
  // today's InternalDashboard exactly as it was.
  const showAdminRow = role === "ADMIN" || role === "MANAGEMENT";

  // Portfolio-health counts via count() rather than fetching every project
  // row and filtering in JS — this is the default post-login landing page,
  // so it stays cheap as the number of projects grows. Run everything in
  // parallel so adding the count queries doesn't cost extra wall-clock time.
  const [total, onTrack, atRisk, critical, recentEvents, adminWidgets] = await Promise.all([
    db.franchiseProject.count(),
    db.franchiseProject.count({ where: { health: "GREEN" } }),
    db.franchiseProject.count({ where: { health: "AMBER" } }),
    db.franchiseProject.count({ where: { health: { in: ["RED", "CRITICAL"] } } }),
    db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { project: { select: { seq: true, brand: true, location: true } } },
    }),
    showAdminRow ? getAdminWidgets() : Promise.resolve(null),
  ]);

  const counts = { total, onTrack, atRisk, critical };

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

      {adminWidgets && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Franchise Pipeline (Admin / Management)
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Onboardings" value={adminWidgets.totalOnboardings} />
            <StatCard label="Sales Users" value={adminWidgets.salesUsers} />
            <StatCard label="KYC Pending" value={adminWidgets.kycPending} />
            <StatCard label="KYC Accepted" value={adminWidgets.kycAccepted} />
            <StatCard label="LOI Pending" value={adminWidgets.loiPending} />
            <StatCard label="LOI Complete" value={adminWidgets.loiComplete} />
            <StatCard
              label="Open Complaints"
              value={adminWidgets.openComplaints}
              caption={adminWidgets.openComplaints > 0 ? "Needs attention" : "All clear"}
              captionClassName={adminWidgets.openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
            />
            <StatCard
              label="Sales This Month"
              value={formatPaiseAsRupees(adminWidgets.salesThisMonth.netSales)}
              caption={`${adminWidgets.salesThisMonth.orders} orders · net, portfolio-wide`}
            />
            <StatCard
              label="Review Workload"
              value={adminWidgets.kycQueueSize + adminWidgets.paymentQueueSize}
              caption={`${adminWidgets.kycQueueSize} KYC · ${adminWidgets.paymentQueueSize} payment`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * plan.md section 20B — ADMIN/MANAGEMENT widget row. Every count is its own
 * direct Prisma query (no stored counters); "KYC/payment queue size" uses the
 * same `status === "SUBMITTED"` definition the KYC/Payment status filters on
 * /store-onboarding use, so this number always matches what filtering the
 * store list by that status would show.
 */
async function getAdminWidgets() {
  const [
    totalOnboardings,
    salesUsers,
    kycPending,
    loiPending,
    openComplaints,
    salesThisMonth,
    kycQueueSize,
    paymentQueueSize,
  ] = await Promise.all([
    db.storeOnboarding.count(),
    db.user.count({ where: { role: "SALES" } }),
    db.storeOnboarding.count({ where: { kycStatus: { not: "ACCEPTED" } } }),
    db.storeOnboarding.count({ where: { onboardingStatus: { not: "LOI_COMPLETE" } } }),
    db.complaint.count({ where: { status: OPEN_COMPLAINT_STATUS_FILTER } }),
    getSalesThisMonth(),
    db.storeOnboarding.count({ where: { kycStatus: "SUBMITTED" } }),
    db.storeOnboarding.count({ where: { paymentStatus: "SUBMITTED" } }),
  ]);

  return {
    totalOnboardings,
    salesUsers,
    kycPending,
    kycAccepted: totalOnboardings - kycPending,
    loiPending,
    loiComplete: totalOnboardings - loiPending,
    openComplaints,
    salesThisMonth,
    kycQueueSize,
    paymentQueueSize,
  };
}

/**
 * plan.md section 20B — SALES home. Everything here is scoped to
 * `salesOwnerId = userId`; a SALES user never sees another rep's stores or
 * portfolio-wide figures (cause-effect #2: "a SALES user's widgets must only
 * reflect stores where salesOwnerId = them").
 */
async function SalesDashboard({ userId }: { userId: string }) {
  const stores = await db.storeOnboarding.findMany({
    where: { salesOwnerId: userId },
    select: {
      id: true,
      seq: true,
      brand: true,
      proposedLocation: true,
      kycStatus: true,
      onboardingStatus: true,
      projectId: true,
    },
  });

  const myStores = stores.length;
  let kycPending = 0;
  let loiPending = 0;
  const activeProjectIds: string[] = [];
  for (const s of stores) {
    if (s.kycStatus !== "ACCEPTED") kycPending++;
    if (s.onboardingStatus !== "LOI_COMPLETE") loiPending++;
    if (s.projectId !== null) activeProjectIds.push(s.projectId);
  }
  const kycAccepted = myStores - kycPending;
  const activeProjects = activeProjectIds.length;
  const openComplaints =
    activeProjectIds.length === 0
      ? 0
      : await db.complaint.count({
          where: { projectId: { in: activeProjectIds }, status: OPEN_COMPLAINT_STATUS_FILTER },
        });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Dashboard"
        subtitle="Your onboarding pipeline and store portfolio"
        isFranchisee={false}
        action={
          <Link href="/store-onboarding" className="text-sm underline underline-offset-4">
            View onboarding queue →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="My Stores" value={myStores} />
        <StatCard label="KYC Pending" value={kycPending} />
        <StatCard label="KYC Accepted" value={kycAccepted} />
        <StatCard label="LOI Pending" value={loiPending} caption="Not yet LOI Complete" />
        <StatCard label="Active Projects" value={activeProjects} caption="Converted stores" />
        <StatCard
          label="Open Complaints"
          value={openComplaints}
          caption="On your stores"
          captionClassName={openComplaints > 0 ? "text-amber-600" : "text-emerald-600"}
        />
      </div>

      {myStores === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No stores assigned to you yet.
          </CardContent>
        </Card>
      )}
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
