"use client";

import { useActionState } from "react";
import { createProject } from "../actions";
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

type PersonOption = { id: string; name: string; email: string };

export function NewProjectForm({
  franchisees,
  internalUsers,
  defaultOwnerId,
}: {
  franchisees: PersonOption[];
  internalUsers: PersonOption[];
  defaultOwnerId?: string;
}) {
  const [state, action, pending] = useActionState(createProject, undefined);

  // Base UI's <Select.Value> (unlike Radix's) shows the raw selected
  // `value` unless given a render function — it doesn't look up the
  // matching SelectItem's children automatically. Build id -> label maps
  // for the two people selects below.
  const franchiseeLabels = Object.fromEntries(
    franchisees.map((f) => [f.id, `${f.name} (${f.email})`])
  );
  const ownerLabels = Object.fromEntries(internalUsers.map((u) => [u.id, u.name]));

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="brand">Brand</Label>
          <Input id="brand" name="brand" defaultValue="Tulsi" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <Input id="format" name="format" placeholder="e.g. Dine-in, QSR, Kiosk" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input id="location" name="location" placeholder="City / site address" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="franchiseeId">Franchisee</Label>
          <Select name="franchiseeId" required>
            <SelectTrigger id="franchiseeId" className="w-full">
              <SelectValue placeholder="Select franchisee">
                {(value: string | null) => (value ? franchiseeLabels[value] : "Select franchisee")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {franchisees.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name} ({f.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerId">Owner</Label>
          <Select name="ownerId" defaultValue={defaultOwnerId} required>
            <SelectTrigger id="ownerId" className="w-full">
              <SelectValue placeholder="Select owner">
                {(value: string | null) => (value ? ownerLabels[value] : "Select owner")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {internalUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="targetOpening">Target Opening</Label>
        <Input id="targetOpening" name="targetOpening" type="date" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nextAction">Next action (optional)</Label>
        <Input id="nextAction" name="nextAction" placeholder="e.g. Await signed LOI" />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create Project"}
      </Button>
    </form>
  );
}
