import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewUserForm } from "./new-user-form";

export default async function NewUserPage() {
  const user = await requireUser();

  if (!canManageUsers(user)) {
    redirect("/site-boq");
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New User</h1>
        <p className="text-sm text-muted-foreground">
          Creates the account and sends an invite link to set a password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">User details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewUserForm />
        </CardContent>
      </Card>
    </div>
  );
}
