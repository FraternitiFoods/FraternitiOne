"use client";

import { useActionState } from "react";
import { updateProjectHeader, type ActionState } from "../actions";
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
import { PROJECT_HEALTH_LABELS } from "@/lib/format";
import type { ProjectHealth } from "@prisma/client";

const HEALTH_OPTIONS: ProjectHealth[] = ["GREEN", "AMBER", "RED", "CRITICAL"];

export function ProjectHeaderForm({
  projectId,
  health,
  nextAction,
  targetOpening,
}: {
  projectId: string;
  health: ProjectHealth;
  nextAction: string | null;
  targetOpening: string; // yyyy-mm-dd
}) {
  const boundAction = updateProjectHeader.bind(null, projectId);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="health">Health</Label>
        <Select name="health" defaultValue={health}>
          <SelectTrigger id="health" className="w-full">
            <SelectValue>
              {(value: ProjectHealth | null) => (value ? PROJECT_HEALTH_LABELS[value] : "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HEALTH_OPTIONS.map((h) => (
              <SelectItem key={h} value={h}>
                {PROJECT_HEALTH_LABELS[h]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="targetOpening">Target opening</Label>
        <Input id="targetOpening" name="targetOpening" type="date" defaultValue={targetOpening} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nextAction">Next action</Label>
        <Input id="nextAction" name="nextAction" defaultValue={nextAction ?? ""} />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
