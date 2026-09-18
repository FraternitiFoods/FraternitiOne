"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updateUser, type UpdateUserState } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS, DEPARTMENT_LABELS } from "@/lib/format";
import { DEPARTMENT_OWNERS } from "@/lib/role-departments";
import type { Role, Department } from "@prisma/client";

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as Department[];

type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: Department | null;
};

export function EditUserForm({ user }: { user: EditableUser }) {
  const boundAction = updateUser.bind(null, user.id);
  const [state, action, pending] = useActionState<UpdateUserState, FormData>(boundAction, undefined);
  const [role, setRole] = useState<Role>(user.role);

  const managedDepartments = DEPARTMENT_OWNERS[role] ?? [];

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required defaultValue={user.name} placeholder="Full name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={user.email}
          placeholder="name@fraterniti.co.in"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        {/* defaultValue (not value) — pre-fills without making the Select
            controlled; see new-user-form.tsx for why `value` is avoided. */}
        <Select
          name="role"
          required
          defaultValue={user.role}
          onValueChange={(v) => setRole(v as Role)}
        >
          <SelectTrigger id="role" className="w-full">
            <SelectValue placeholder="Select role">
              {(value: Role | null) => (value ? ROLE_LABELS[value] : "Select role")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {managedDepartments.length > 0
            ? `This role manages: ${managedDepartments.map((d) => DEPARTMENT_LABELS[d]).join(", ")}.`
            : role === "MANAGEMENT" || role === "ADMIN"
              ? "This role has cross-department access to every module."
              : "This role has no module access by default."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="department">Department label (optional)</Label>
        <Select name="department" defaultValue={user.department ?? undefined}>
          <SelectTrigger id="department" className="w-full">
            <SelectValue placeholder="No department">
              {(value: Department | null) => (value ? DEPARTMENT_LABELS[value] : "No department")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Informational only — what this person actually manages is governed by their role above,
          not this field.
        </p>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
