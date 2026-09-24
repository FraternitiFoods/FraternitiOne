import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canViewProject } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { formatProjectCode } from "@/lib/format";
import { computeCategoryProgress } from "@/lib/category-progress";
import { CategoryTile } from "../projects/[id]/category-tile";

/**
 * Dedicated screen for the "BOQ" grid (also embedded on the project detail
 * page) — reachable straight from the sidebar instead of only via a
 * project's Overview section. Only covers categories sourced from the
 * founder's BOQ Excel (route: "BOQ", see ops-route.ts) — the process
 * checklists (Interior/OPERATION/MARKETING/HR/CULINARY's pre-opening steps)
 * live on the separate /construction-ops screen. Franchisees are
 * auto-scoped to their own project like the dashboard; internal roles pick
 * a project first (`?project=<id>`, same pattern as /audit) since they work
 * across many.
 */
export default async function BoqPage(props: PageProps<"/boq">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const requestedProjectId = typeof projectParam === "string" ? projectParam : undefined;

  const projects = await db.franchiseProject.findMany({
    where: user.role === "FRANCHISEE" ? { franchiseeId: user.id } : undefined,
    select: { id: true, brand: true, location: true, seq: true },
    orderBy: { createdAt: "desc" },
  });

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="BOQ" isFranchisee={user.role === "FRANCHISEE"} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {user.role === "FRANCHISEE" ? "No franchise project is linked to your account yet." : "No projects yet."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeProjectId =
    (requestedProjectId && projects.some((p) => p.id === requestedProjectId) && requestedProjectId) ||
    (user.role === "FRANCHISEE" ? projects[0].id : undefined);

  // Internal roles land on a project picker first — mixing categories across
  // different projects' BOQ checklists into one grid wouldn't mean anything,
  // so there's no portfolio-wide rollup here, unlike /projects.
  if (!activeProjectId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="BOQ"
          subtitle="Pick a project to see its trade/department rollup"
          isFranchisee={false}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/boq?project=${project.id}`}
              className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
            >
              <div className="text-sm font-medium">
                {project.brand} — {project.location}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{formatProjectCode(project.seq)}</div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const project = await db.franchiseProject.findUnique({
    where: { id: activeProjectId },
    include: { tasks: { select: { category: true, status: true, title: true } } },
  });

  if (!project || !canViewProject(user, project)) {
    return (
      <div>
        <PageHeader title="BOQ" isFranchisee={user.role === "FRANCHISEE"} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Project not found.</CardContent>
        </Card>
      </div>
    );
  }

  const categoryProgress = computeCategoryProgress(project.tasks, "BOQ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="BOQ"
        subtitle={`${project.brand} — ${project.location} · ${formatProjectCode(project.seq)}`}
        isFranchisee={user.role === "FRANCHISEE"}
        action={
          <>
            {user.role !== "FRANCHISEE" && projects.length > 1 && (
              <Link href="/boq" className="text-sm underline underline-offset-4">
                Switch project →
              </Link>
            )}
            <Link href={`/projects/${project.id}`} className="text-sm underline underline-offset-4">
              Open project →
            </Link>
          </>
        }
      />

      {categoryProgress.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No BOQ checklist tasks on this project yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How far each trade has reached</CardTitle>
            <p className="text-xs text-muted-foreground">Rolled up from the BOQ checklist</p>
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
                  projectId={project.id}
                  backHref={`/boq?project=${project.id}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
