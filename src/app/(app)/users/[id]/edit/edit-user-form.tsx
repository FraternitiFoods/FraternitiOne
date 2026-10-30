"use client";

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
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

const ROLES = Object.keys(ROLE_LABELS) as Role[];

type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export function EditUserForm({ user }: { user: EditableUser }) {
  const boundAction = updateUser.bind(null, user.id);
  const [state, action, pending] = useActionState<UpdateUserState, FormData>(boundAction, undefined);

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
        <Select name="role" required defaultValue={user.role}>
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
