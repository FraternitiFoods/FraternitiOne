import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  formatProjectCode,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_ORDER,
  PROJECT_HEALTH_LABELS,
} from "@/lib/format";
import type { ProjectHealth } from "@prisma/client";

const HEALTH_BADGE_VARIANT: Record<ProjectHealth, "default" | "secondary" | "destructive"> = {
  GREEN: "secondary",
  AMBER: "default",
  RED: "destructive",
  CRITICAL: "destructive",
};

export default async function DashboardPage() {
  const user = await requireUser();

  const projects = await db.franchiseProject.findMany({
    where: user.role === "FRANCHISEE" ? { franchiseeId: user.id } : undefined,
    include: {
      owner: { select: { name: true } },
      franchisee: { select: { name: true } },
      tasks: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Home Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Lifecycle stage, progress, target opening, owner and next action —
            FR-002.
          </p>
        </div>
        <Link href="/projects" className="text-sm underline underline-offset-4">
          View all projects →
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {user.role === "FRANCHISEE"
              ? "No franchise project is linked to your account yet."
              : "No franchise projects yet. Create the first one from Projects."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const total = project.tasks.length;
            const completed = project.tasks.filter((t) => t.status === "COMPLETED").length;
            // Simple task-completion-ratio proxy for "progress %" (FR-002).
            // The SRD's real formula (section 9) is milestone-weighted and
            // depends on the Milestone entity, which is Phase 2+ (plan.md
            // section 2) — this is a documented placeholder, not the final
            // calculation.
            const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);
            const stageIndex = LIFECYCLE_STAGE_ORDER.indexOf(project.lifecycleStage);

            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full transition-colors hover:border-foreground/30">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          {project.brand} — {project.location}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {formatProjectCode(project.seq)} · {project.format}
                        </p>
                      </div>
                      <Badge variant={HEALTH_BADGE_VARIANT[project.health]}>
                        {PROJECT_HEALTH_LABELS[project.health]}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          Stage {stageIndex + 1} of {LIFECYCLE_STAGE_ORDER.length}
                        </span>
                        <span>{progressPct}% tasks done</span>
                      </div>
                      <div className="mt-1 font-medium">
                        {LIFECYCLE_STAGE_LABELS[project.lifecycleStage]}
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Target opening</dt>
                      <dd>{formatDate(project.targetOpening)}</dd>
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd>{project.owner.name}</dd>
                      <dt className="text-muted-foreground">Franchisee</dt>
                      <dd>{project.franchisee.name}</dd>
                    </dl>

                    {project.nextAction && (
                      <p className="rounded-md bg-muted px-2 py-1.5 text-xs">
                        <span className="font-medium">Next action: </span>
                        {project.nextAction}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
