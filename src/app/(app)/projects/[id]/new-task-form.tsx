"use client";

import { useActionState } from "react";
import { createTask, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENT_LABELS, TASK_PRIORITY_LABELS } from "@/lib/format";
import type { Department, TaskPriority } from "@prisma/client";

type PersonOption = { id: string; name: string };
type TaskOption = { id: string; title: string };

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function NewTaskForm({
  projectId,
  modules,
  people,
  existingTasks,
}: {
  projectId: string;
  modules: Department[];
  people: PersonOption[];
  existingTasks: TaskOption[];
}) {
  const boundAction = createTask.bind(null, projectId);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    boundAction,
    undefined
  );

  // See NewProjectForm for why these value -> label maps are needed.
  const personLabels = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const taskLabels = Object.fromEntries(existingTasks.map((t) => [t.id, t.title]));

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="module">Module</Label>
          <Select name="module" required>
            <SelectTrigger id="module" className="w-full">
              <SelectValue placeholder="Select module">
                {(value: Department | null) => (value ? DEPARTMENT_LABELS[value] : "Select module")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>
                  {DEPARTMENT_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select name="priority" defaultValue="MEDIUM">
            <SelectTrigger id="priority" className="w-full">
              <SelectValue>
                {(value: TaskPriority | null) => (value ? TASK_PRIORITY_LABELS[value] : "")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required placeholder="e.g. Upload signed LOI" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ownerId">Owner</Label>
          <Select name="ownerId" required>
            <SelectTrigger id="ownerId" className="w-full">
              <SelectValue placeholder="Select owner">
                {(value: string | null) => (value ? personLabels[value] : "Select owner")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dueDate">Due date (optional)</Label>
          <Input id="dueDate" name="dueDate" type="date" />
        </div>
      </div>

      {existingTasks.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="dependsOnId">Depends on (optional)</Label>
          <Select name="dependsOnId">
            <SelectTrigger id="dependsOnId" className="w-full">
              <SelectValue placeholder="No dependency">
                {(value: string | null) => (value ? taskLabels[value] : "No dependency")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {existingTasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add Task"}
      </Button>
    </form>
  );
}
