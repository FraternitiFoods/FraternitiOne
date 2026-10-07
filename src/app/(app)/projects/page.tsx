import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateProject } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatProjectCode, PROJECT_HEALTH_LABELS } from "@/lib/format";
import { summarizeProjectStage } from "@/lib/lifecycle-stage-status";
import { HEALTH_BADGE_CLASS } from "@/lib/badge-colors";

// SRD wireframe 19 "Management Command Centre": portfolio heatmap — stage,
// readiness, opening date, health, owner, one row per Project ID (FR-001).
export default async function ProjectsPage() {
  const user = await requireUser();

  const where = user.role === "FRANCHISEE" ? { franchiseeId: user.id } : undefined;

  // The stat tiles above the table summarize the *whole* scoped portfolio,
  // not just the rows currently on screen, so they're computed from their
  // own aggregate queries rather than from `projects` below — otherwise
  // capping the table with `take` would silently make these numbers wrong
  // once there are more than 50 projects. Run everything in parallel so the
  // cap doesn't cost any extra wall-clock time.
  const [projects, totalCount, onTrack, atRisk, critical, cityRows] = await Promise.all([
    db.franchiseProject.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        franchisee: { select: { name: true } },
        tasks: { select: { status: true, lifecycleStage: true } },
        stageOverrides: { select: { stage: true } },
      },
      orderBy: { createdAt: "desc" },
      // Portfolio dashboard, not an export — cap the row count so this stays
      // cheap to query/render/serialize as the number of projects grows.
      take: 50,
    }),
    db.franchiseProject.count({ where }),
    db.franchiseProject.count({ where: { ...where, health: "GREEN" } }),
    db.franchiseProject.count({ where: { ...where, health: "AMBER" } }),
    db.franchiseProject.count({ where: { ...where, health: { in: ["RED", "CRITICAL"] } } }),
    db.franchiseProject.findMany({ where, select: { location: true }, distinct: ["location"] }),
  ]);

  const counts = {
    total: totalCount,
    onTrack,
    atRisk,
    critical,
    cities: cityRows.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle="One row per Project ID — every task, document and audit event attaches to one of these (FR-001)."
        isFranchisee={user.role === "FRANCHISEE"}
        action={
          canCreateProject(user) ? (
            // nativeButton=false: we're rendering an <a> (via Link) through
            // the `render` prop, not a native <button> — Base UI warns
            // ("expected a native <button>") without this, since its default
            // assumes the rendered element behaves like one.
            <Button nativeButton={false} render={<Link href="/projects/new">New Project</Link>} />
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Projects"
          value={counts.total}
          caption={counts.cities === 1 ? "1 city" : `${counts.cities} cities`}
        />
        <StatCard
          label="On Track"
          value={counts.onTrack}
          caption={counts.total ? `${Math.round((counts.onTrack / counts.total) * 100)}%` : "—"}
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

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Ready</TableHead>
              <TableHead>Opening</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Franchisee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  No projects yet.
                </TableCell>
              </TableRow>
            )}
            {projects.map((project) => {
              const total = project.tasks.length;
              const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;
              const readyPct = total === 0 ? 0 : Math.round((completed / total) * 100);

              return (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link href={`/projects/${project.id}`} className="font-medium underline underline-offset-4">
                      {project.brand} — {project.location}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {formatProjectCode(project.seq)} · {project.format}
                    </div>
                  </TableCell>
                  <TableCell>
                    {summarizeProjectStage(
                      project.tasks,
                      new Set(project.stageOverrides.map((o) => o.stage))
                    )}
                  </TableCell>
                  <TableCell>{readyPct}%</TableCell>
                  <TableCell>{formatDate(project.targetOpening)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={HEALTH_BADGE_CLASS[project.health]}>
                      {PROJECT_HEALTH_LABELS[project.health]}
                    </Badge>
                  </TableCell>
                  <TableCell>{project.owner.name}</TableCell>
                  <TableCell>{project.franchisee.name}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
