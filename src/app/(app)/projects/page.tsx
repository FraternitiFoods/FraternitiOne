import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateProject } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatProjectCode,
  LIFECYCLE_STAGE_LABELS,
  PROJECT_HEALTH_LABELS,
} from "@/lib/format";
import type { ProjectHealth } from "@prisma/client";

const HEALTH_BADGE_VARIANT: Record<ProjectHealth, "default" | "secondary" | "destructive"> = {
  GREEN: "secondary",
  AMBER: "default",
  RED: "destructive",
  CRITICAL: "destructive",
};

export default async function ProjectsPage() {
  const user = await requireUser();

  const projects = await db.franchiseProject.findMany({
    where: user.role === "FRANCHISEE" ? { franchiseeId: user.id } : undefined,
    include: {
      owner: { select: { name: true } },
      franchisee: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            One row per Project ID — every task, document and audit event
            attaches to one of these (FR-001).
          </p>
        </div>
        {canCreateProject(user) && (
          <Button render={<Link href="/projects/new">New Project</Link>} />
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Brand / Location</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Target Opening</TableHead>
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
            {projects.map((project) => (
              <TableRow key={project.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/projects/${project.id}`} className="font-medium underline underline-offset-4">
                    {formatProjectCode(project.seq)}
                  </Link>
                </TableCell>
                <TableCell>
                  {project.brand} — {project.location}
                  <div className="text-xs text-muted-foreground">{project.format}</div>
                </TableCell>
                <TableCell>{LIFECYCLE_STAGE_LABELS[project.lifecycleStage]}</TableCell>
                <TableCell>
                  <Badge variant={HEALTH_BADGE_VARIANT[project.health]}>
                    {PROJECT_HEALTH_LABELS[project.health]}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(project.targetOpening)}</TableCell>
                <TableCell>{project.owner.name}</TableCell>
                <TableCell>{project.franchisee.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
