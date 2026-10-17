"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { STATUS_OPTIONS } from "../projects/[id]/task-card";
import { updateTaskStatusFromActions, type ActionState } from "./actions";
import {
  DEPARTMENT_LABELS,
  LIFECYCLE_STAGE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatProjectCode,
} from "@/lib/format";
import { TASK_PRIORITY_BADGE_CLASS, TASK_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { ActionItem } from "./actions-list";

/**
 * One Action Centre row: the title/project area stays a `<Link>` out to the
 * task's stage page (full context — comments, documents, title if admin),
 * and a compact status-change `<form>` sits alongside it for a fast update
 * without leaving the page. A form can't nest inside an `<a>`, so unlike the
 * old single-Link row, these are now siblings in a flex row.
 */
export function ActionRow({ task }: { task: ActionItem }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateTaskStatusFromActions.bind(null, task.id),
    undefined
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <Link
        href={`/projects/${task.projectId}/stages/${task.lifecycleStage}`}
        className="min-w-0 flex-1 transition-colors hover:text-foreground"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{task.title}</span>
          <Badge variant="outline">{DEPARTMENT_LABELS[task.module]}</Badge>
          {task.category && <Badge variant="outline">{task.category}</Badge>}
          <Badge variant="outline">{LIFECYCLE_STAGE_LABELS[task.lifecycleStage]}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatProjectCode(task.projectSeq)} — {task.projectBrand}, {task.projectLocation}
        </div>
      </Link>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</span>
        )}
        {task.timingBadge && (
          <Badge variant="outline" className={task.timingBadge.className}>
            {task.timingBadge.label}
          </Badge>
        )}
        <Badge variant="outline" className={TASK_PRIORITY_BADGE_CLASS[task.priority]}>
          {TASK_PRIORITY_LABELS[task.priority]}
        </Badge>
        <form action={formAction} className="flex items-center gap-1.5">
          <Select name="status" defaultValue={task.status}>
            <SelectTrigger className={`h-7 w-[150px] text-xs ${TASK_STATUS_BADGE_CLASS[task.status]}`}>
              <SelectValue>
                {(value: typeof task.status | null) => (value ? TASK_STATUS_LABELS[value] : "")}
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
          <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={pending}>
            {pending ? "…" : "Update"}
          </Button>
        </form>
      </div>
      {state?.error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
