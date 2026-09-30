"use client";

import { useActionState } from "react";
import { createComplaint, type ActionState } from "./actions";
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
import { COMPLAINT_CATEGORY_LABELS, TASK_PRIORITY_LABELS } from "@/lib/format";
import { COMPLAINT_CATEGORIES } from "@/lib/complaint-categories";
import type { ComplaintCategory, TaskPriority } from "@prisma/client";

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function NewComplaintForm({ projectId, returnPath }: { projectId: string; returnPath?: string }) {
  const boundAction = createComplaint.bind(null, projectId, returnPath ?? `/projects/${projectId}`);
  const [state, action, pending] = useActionState<ActionState, FormData>(boundAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="complaint-category">Category</Label>
          <Select name="category" required>
            <SelectTrigger id="complaint-category" className="w-full">
              <SelectValue placeholder="Select category">
                {(value: ComplaintCategory | null) => (value ? COMPLAINT_CATEGORY_LABELS[value] : "Select category")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMPLAINT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {COMPLAINT_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="complaint-priority">Priority</Label>
          <Select name="priority" defaultValue="MEDIUM">
            <SelectTrigger id="complaint-priority" className="w-full">
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
        <Label htmlFor="complaint-subject">Subject</Label>
        <Input id="complaint-subject" name="subject" required placeholder="e.g. Tiles cracked in kitchen area" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="complaint-description">Description</Label>
        <Textarea id="complaint-description" name="description" rows={3} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="complaint-attachment">Attachment (optional)</Label>
        <Input id="complaint-attachment" name="attachment" type="file" />
        <p className="text-xs text-muted-foreground">PDF, JPG, PNG, or WEBP — up to 15MB.</p>
      </div>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Submitting…" : "Raise Complaint"}
      </Button>
    </form>
  );
}
