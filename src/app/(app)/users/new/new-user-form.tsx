"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createUser, type ActionState } from "../actions";
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

// SITE_SUPERVISOR is excluded here for now — this form only collects
// email+password (plan.md section 16, build order step 2 extends it with
// phone+PIN+project assignment, the fields a supervisor account actually
// needs to log in). Creating one through this form today would leave both
// null and permanently locked out.
const ROLES = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "SITE_SUPERVISOR");
const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as Department[];

export function NewUserForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createUser, undefined);
  const [role, setRole] = useState<Role | undefined>(undefined);

  const managedDepartments = role ? DEPARTMENT_OWNERS[role] : [];

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="Full name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required placeholder="name@fraterniti.co.in" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        {/* Uncontrolled (no `value` prop) — only `onValueChange` is used, to
            drive the "this role manages..." hint below. Passing `value`
            here would make Base UI's Select flip from uncontrolled to
            controlled on the very first selection (it decides controlled
            vs. uncontrolled at first render, based on whether `value` is
            `undefined`), which Base UI warns about and which desyncs the
            component's internal state from what's submitted. */}
        <Select name="role" required onValueChange={(v) => setRole(v as Role)}>
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
        {role && (
          <p className="text-xs text-muted-foreground">
            {managedDepartments.length > 0
              ? `This role manages: ${managedDepartments.map((d) => DEPARTMENT_LABELS[d]).join(", ")}.`
              : role === "MANAGEMENT" || role === "ADMIN"
                ? "This role has cross-department access to every module."
                : "This role has no module access by default."}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="department">Department label (optional)</Label>
        <Select name="department">
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
        {pending ? "Creating…" : "Create user & send invite"}
      </Button>
    </form>
  );
}
