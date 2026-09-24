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

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as Department[];

type ProjectOption = { id: string; brand: string; location: string };

export function NewUserForm({ projects }: { projects: ProjectOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createUser, undefined);
  const [role, setRole] = useState<Role | undefined>(undefined);

  const isSupervisor = role === "SITE_SUPERVISOR";
  const managedDepartments = role ? DEPARTMENT_OWNERS[role] : [];

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="Full name" />
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
            {isSupervisor
              ? "Access is scoped to the specific projects assigned below, not a department."
              : managedDepartments.length > 0
                ? `This role manages: ${managedDepartments.map((d) => DEPARTMENT_LABELS[d]).join(", ")}.`
                : role === "MANAGEMENT" || role === "ADMIN"
                  ? "This role has cross-department access to every module."
                  : "This role has no module access by default."}
          </p>
        )}
      </div>

      {isSupervisor ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              required
              placeholder="10-digit mobile number"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pin">PIN (6 digits)</Label>
              <Input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPin">Confirm PIN</Label>
              <Input
                id="confirmPin"
                name="confirmPin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="••••••"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assign to projects</Label>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects exist yet.</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-3">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="projectIds" value={p.id} className="size-4" />
                    {p.brand} — {p.location}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A supervisor can only see and upload against projects checked here.
            </p>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="name@fraterniti.co.in" />
        </div>
      )}

      {!isSupervisor && (
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
      )}

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : isSupervisor ? "Create supervisor" : "Create user & send invite"}
      </Button>
    </form>
  );
}
