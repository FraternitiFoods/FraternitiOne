import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageSales } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatProjectCode } from "@/lib/format";
import { ImportForm } from "./import-form";

/** Admin-only (section 20A "NOT DECIDED YET" #2 working default). */
export default async function SalesImportPage(props: PageProps<"/sales/import">) {
  const user = await requireUser();
  if (!canManageSales(user)) {
    redirect("/dashboard");
  }

  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const requestedProjectId = typeof projectParam === "string" ? projectParam : undefined;

  const projects = await db.franchiseProject.findMany({
    select: { id: true, seq: true, brand: true, location: true },
    orderBy: { createdAt: "desc" },
  });

  if (!requestedProjectId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Import Sales CSV" subtitle="Pick a store to import into" isFranchisee={false} />
        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">No projects yet.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/sales/import?project=${project.id}`}
                className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
              >
                <div className="text-sm font-medium">
                  {project.brand} — {project.location}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{formatProjectCode(project.seq)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const project = projects.find((p) => p.id === requestedProjectId);
  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Sales CSV"
        subtitle={
          <>
            {project.brand} — {project.location} · {formatProjectCode(project.seq)}
          </>
        }
        isFranchisee={false}
        action={
          <Link href={`/sales?project=${project.id}`} className="text-sm underline underline-offset-4">
            Back to Sales →
          </Link>
        }
      />
      <ImportForm projectId={project.id} returnPath={`/sales?project=${project.id}`} />
    </div>
  );
}
