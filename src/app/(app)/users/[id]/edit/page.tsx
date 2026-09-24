import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditUserForm } from "./edit-user-form";

export default async function EditUserPage(props: PageProps<"/users/[id]/edit">) {
  const { id } = await props.params;
  const admin = await requireUser();

  if (!canManageUsers(admin)) {
    redirect("/dashboard");
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, department: true },
  });

  if (!user) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit user</h1>
        <p className="text-sm text-muted-foreground">
          Password and active status are managed separately — see the users list.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">User details</CardTitle>
        </CardHeader>
        <CardContent>
          {user.role === "SITE_SUPERVISOR" ? (
            <p className="text-sm text-muted-foreground">
              Editing site supervisors isn&apos;t built yet (plan.md section 16, build order
              step 2 only covers creation). Use &quot;Reset PIN&quot; or &quot;Delete&quot; from the
              users list for now.
            </p>
          ) : (
            <EditUserForm user={user} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
