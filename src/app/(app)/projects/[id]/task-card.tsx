"use client";

import { useActionState, useState } from "react";
import { updateTaskStatus, updateTaskTitle, addTaskComment, moveTask, type ActionState } from "./actions";
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
  LIFECYCLE_STAGE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import { TASK_PRIORITY_BADGE_CLASS, TASK_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { LifecycleStage, TaskPriority, TaskStatus } from "@prisma/client";

const STATUS_OPTIONS: TaskStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_FRANCHISEE",
  "AWAITING_INTERNAL",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];

export type TaskCardData = {
  id: string;
  title: string;
  description: string | null;
  module: string;
  lifecycleStage: LifecycleStage;
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
  reorder,
  returnPath,
}: {
  task: TaskCardData;
  projectId: string;
  canAct: boolean;
  /** Only passed by the stage detail page, which shows one stage's tasks in
   * order — the flat project-wide list has no single "stage order" to
   * swap within, so it omits this and the buttons don't render. */
  reorder?: { canMoveUp: boolean; canMoveDown: boolean };
  /** Where an action should redirect back to after it runs — defaults to
   * the main project page; the stage detail page passes its own path so
   * actions there don't bounce the user back out to the project page. */
  returnPath?: string;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const redirectTo = returnPath ?? `/projects/${projectId}`;

  const statusAction = useActionState<ActionState, FormData>(
    updateTaskStatus.bind(null, task.id, projectId, redirectTo),
    undefined
  );
  const commentAction = useActionState<ActionState, FormData>(
    addTaskComment.bind(null, task.id, projectId, redirectTo),
    undefined
  );
  const titleActionState = useActionState<ActionState, FormData>(
    updateTaskTitle.bind(null, task.id, projectId, redirectTo),
    undefined
  );
  const [, moveUpFormAction, moveUpPending] = useActionState<ActionState, FormData>(
    moveTask.bind(null, task.id, projectId, "up", redirectTo),
    undefined
  );
  const [, moveDownFormAction, moveDownPending] = useActionState<ActionState, FormData>(
    moveTask.bind(null, task.id, projectId, "down", redirectTo),
    undefined
  );

  const [statusState, statusFormAction, statusPending] = statusAction;
  const [commentState, commentFormAction, commentPending] = commentAction;
  const [titleState, titleFormAction, titlePending] = titleActionState;

  return (
    <div className="rounded-lg bg-card p-4 space-y-3 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {reorder && canAct && (
              <div className="flex flex-col">
                <form action={moveUpFormAction}>
                  <button
                    type="submit"
                    disabled={!reorder.canMoveUp || moveUpPending}
                    className="leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move task up"
                  >
                    ▲
                  </button>
                </form>
                <form action={moveDownFormAction}>
                  <button
                    type="submit"
                    disabled={!reorder.canMoveDown || moveDownPending}
                    className="leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move task down"
                  >
                    ▼
                  </button>
                </form>
              </div>
            )}
            {editingTitle ? (
              <form
                action={titleFormAction}
                className="flex items-center gap-2"
                onSubmit={() => setEditingTitle(false)}
              >
                <Input name="title" defaultValue={task.title} className="h-7 w-56" autoFocus />
                <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={titlePending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditingTitle(false)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="font-medium">{task.title}</span>
                {canAct && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setEditingTitle(true)}
                  >
                    Edit
                  </button>
                )}
              </>
            )}
            <Badge variant="outline">{LIFECYCLE_STAGE_LABELS[task.lifecycleStage]}</Badge>
            <Badge variant="outline">{DEPARTMENT_LABELS[task.module as keyof typeof DEPARTMENT_LABELS] ?? task.module}</Badge>
            <Badge variant="outline" className={TASK_PRIORITY_BADGE_CLASS[task.priority]}>
              {TASK_PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
          {titleState?.error && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {titleState.error}
            </p>
          )}
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
        <Badge variant="outline" className={TASK_STATUS_BADGE_CLASS[task.status]}>
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
