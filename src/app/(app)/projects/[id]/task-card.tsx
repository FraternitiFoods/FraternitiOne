"use client";

import { useActionState } from "react";
import { updateTaskStatus, addTaskComment, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEPARTMENT_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import type { TaskPriority, TaskStatus } from "@prisma/client";

const STATUS_OPTIONS: TaskStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_FRANCHISEE",
  "AWAITING_INTERNAL",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];

const PRIORITY_BADGE_VARIANT: Record<TaskPriority, "default" | "secondary" | "destructive"> = {
  LOW: "secondary",
  MEDIUM: "default",
  HIGH: "default",
  CRITICAL: "destructive",
};

export type TaskCardData = {
  id: string;
  title: string;
  description: string | null;
  module: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null; // ISO
  completionEvidence: string | null;
  owner: { name: string };
  createdBy: { name: string };
  dependsOn: { title: string } | null;
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
};

export function TaskCard({
  task,
  projectId,
  canAct,
}: {
  task: TaskCardData;
  projectId: string;
  canAct: boolean;
}) {
  const statusAction = useActionState<ActionState, FormData>(
    updateTaskStatus.bind(null, task.id, projectId),
    undefined
  );
  const commentAction = useActionState<ActionState, FormData>(
    addTaskComment.bind(null, task.id, projectId),
    undefined
  );

  const [statusState, statusFormAction, statusPending] = statusAction;
  const [commentState, commentFormAction, commentPending] = commentAction;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{task.title}</span>
            <Badge variant="outline">{DEPARTMENT_LABELS[task.module as keyof typeof DEPARTMENT_LABELS] ?? task.module}</Badge>
            <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>
              {TASK_PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
          {task.description && (
            <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
          )}
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Owner: {task.owner.name}</span>
            <span>Created by: {task.createdBy.name}</span>
            {task.dueDate && <span>Due: {formatDate(task.dueDate)}</span>}
            {task.dependsOn && <span>Depends on: {task.dependsOn.title}</span>}
          </dl>
          {task.completionEvidence && (
            <p className="mt-1 text-xs">
              <span className="font-medium">Completion evidence: </span>
              {task.completionEvidence}
            </p>
          )}
        </div>
        <Badge variant={task.status === "COMPLETED" ? "secondary" : "outline"}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
      </div>

      {canAct && (
        <form action={statusFormAction} className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="space-y-1">
            <Select name="status" defaultValue={task.status}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue>
                  {(value: TaskStatus | null) => (value ? TASK_STATUS_LABELS[value] : "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            name="completionEvidence"
            placeholder="Completion evidence (if completing)"
            defaultValue={task.completionEvidence ?? ""}
            className="h-8 flex-1 min-w-[200px]"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>
            {statusPending ? "Saving…" : "Update status"}
          </Button>
          {statusState?.error && (
            <p className="w-full text-xs text-destructive">{statusState.error}</p>
          )}
        </form>
      )}

      <div className="border-t pt-3 space-y-2">
        {task.comments.length > 0 && (
          <ul className="space-y-1.5">
            {task.comments.map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-medium">{c.author.name}</span>{" "}
                <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form action={commentFormAction} className="flex gap-2">
          <Input name="body" placeholder="Add a comment…" className="h-8 flex-1" />
          <Button type="submit" size="sm" variant="outline" disabled={commentPending}>
            {commentPending ? "Posting…" : "Comment"}
          </Button>
        </form>
        {commentState?.error && (
          <p className="text-xs text-destructive">{commentState.error}</p>
        )}
      </div>
    </div>
  );
}
