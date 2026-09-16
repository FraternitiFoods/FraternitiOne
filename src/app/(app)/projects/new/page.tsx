import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateProject } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const user = await requireUser();

  if (!canCreateProject(user)) {
    redirect("/projects");
  }

  const [franchisees, internalUsers] = await Promise.all([
    db.user.findMany({
      where: { role: "FRANCHISEE", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { role: { not: "FRANCHISEE" }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Franchise Project</h1>
        <p className="text-sm text-muted-foreground">
          Creates the one Project ID everything else attaches to (FR-001).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project details</CardTitle>
        </CardHeader>
        <CardContent>
          {franchisees.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No franchisee accounts exist yet. Create one (via the database
              seed, or user management once built) before creating a project.
            </p>
          ) : (
            <NewProjectForm
              franchisees={franchisees}
              internalUsers={internalUsers}
              defaultOwnerId={user.role !== "FRANCHISEE" ? user.id : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
