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
import { ResetPinButton } from "./reset-pin-button";
import { DeleteUserButton } from "./delete-user-button";
import { DeactivateUserButton } from "./deactivate-user-button";

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
      phone: true,
      role: true,
      department: true,
      isActive: true,
      passwordHash: true,
      // Only populated for SITE_SUPERVISOR rows — cheap enough to always
      // include (Phase 1 user counts are small) rather than branching the
      // query per role.
      projectMemberships: {
        select: { project: { select: { brand: true, location: true } } },
      },
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
              <TableHead>Contact</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department / Projects</TableHead>
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
            {users.map((u) => {
              const isSupervisor = u.role === "SITE_SUPERVISOR";
              // A supervisor's PIN is always set synchronously at creation
              // (no invite-link step, plan.md section 16) — so "pending"
              // only ever applies to the email+password flow.
              const invitePending = !isSupervisor && !u.passwordHash;

              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.email ?? u.phone ?? "—"}
                  </TableCell>
                  <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {isSupervisor ? (
                      u.projectMemberships.length > 0 ? (
                        u.projectMemberships.map((m) => `${m.project.brand} — ${m.project.location}`).join(", ")
                      ) : (
                        "No projects assigned"
                      )
                    ) : u.department ? (
                      DEPARTMENT_LABELS[u.department]
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {!u.isActive ? (
                      <Badge variant="outline">Inactive</Badge>
                    ) : invitePending ? (
                      <Badge variant="secondary">Invite pending</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {u.isActive && invitePending && <ResendInviteButton userId={u.id} />}
                      {u.isActive && isSupervisor && <ResetPinButton userId={u.id} name={u.name} />}
                      <Button
                        nativeButton={false}
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        render={<Link href={`/users/${u.id}/edit`} />}
                      >
                        Edit
                      </Button>
                      {u.id !== user.id && (
                        <>
                          <DeactivateUserButton userId={u.id} isActive={u.isActive} />
                          <DeleteUserButton userId={u.id} name={u.name} email={u.email} />
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
