import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewUserForm } from "./new-user-form";

export default async function NewUserPage() {
  const user = await requireUser();

  if (!canManageUsers(user)) {
    redirect("/dashboard");
  }

  // Only needed for the SITE_SUPERVISOR branch of the form (project
  // assignment, plan.md section 16) — fetched unconditionally since this is
  // a Server Component and the role picker is client-side.
  const projects = await db.franchiseProject.findMany({
    select: { id: true, brand: true, location: true },
    orderBy: [{ brand: "asc" }, { location: "asc" }],
  });

  // Category has no fixed master list (Task.category's own schema comment —
  // the real BOQ/Ops checklist carries ~28 freeform trade categories). The
  // dropdown's options are the distinct values already in use across every
  // project's tasks, which is the de-facto list in practice.
  const categoryRows = await db.task.findMany({
    where: { category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  const categoryOptions = categoryRows.map((t) => t.category as string);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New User</h1>
        <p className="text-sm text-muted-foreground">
          Creates the account. Email-based accounts get an invite link to set a
          password; site supervisors get a phone + PIN set here directly.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">User details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewUserForm projects={projects} categoryOptions={categoryOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
