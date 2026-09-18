import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { ROLE_LABELS, DEPARTMENT_LABELS } from "@/lib/format";
import { ResendInviteButton } from "./resend-invite-button";
import { DeleteUserButton } from "./delete-user-button";

export default async function UsersPage() {
  const user = await requireUser();

  if (!canManageUsers(user)) {
    redirect("/dashboard");
  }

  const users = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      department: true,
      isActive: true,
      passwordHash: true,
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        subtitle="Create and view accounts (Admin only)."
        isFranchisee={false}
        action={
          // nativeButton=false: rendering an <a> (via Link) through the
          // `render` prop, not a native <button> — see ProjectsPage's
          // "New Project" button for the same pattern.
          <Button nativeButton={false} size="sm" render={<Link href="/users/new">New user</Link>} />
        }
      />

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                <TableCell className="text-muted-foreground">
                  {u.department ? DEPARTMENT_LABELS[u.department] : "—"}
                </TableCell>
                <TableCell>
                  {!u.isActive ? (
                    <Badge variant="outline">Inactive</Badge>
                  ) : !u.passwordHash ? (
                    <Badge variant="secondary">Invite pending</Badge>
                  ) : (
                    <Badge variant="outline">Active</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {u.isActive && !u.passwordHash && <ResendInviteButton userId={u.id} />}
                    {u.id !== user.id && (
                      <DeleteUserButton userId={u.id} name={u.name} email={u.email} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
