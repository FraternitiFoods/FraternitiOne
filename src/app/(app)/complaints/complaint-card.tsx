"use client";

import { useActionState, useState } from "react";
import { cn } from "cn";
import { updateComplaintStatus, assignComplaint, addComplaintComment, type ActionState } from "./actions";
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
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  formatComplaintCode,
  formatDate,
  formatDateTime,
  formatProjectCode,
} from "@/lib/format";
import { COMPLAINT_STATUS_BADGE_CLASS, TASK_PRIORITY_BADGE_CLASS } from "@/lib/badge-colors";
import type { ComplaintCategory, ComplaintStatus, TaskPriority } from "@prisma/client";

export const STATUS_OPTIONS: ComplaintStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_FRANCHISEE",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];

export type ComplaintCardData = {
  id: string;
  seq: number;
  category: ComplaintCategory;
  subject: string;
  description: string;
  priority: TaskPriority;
  status: ComplaintStatus;
  raisedBy: { name: string };
  assignedTo: { id: string; name: string } | null;
  attachmentFileName: string | null;
  resolutionDate: string | null; // ISO
  createdAt: string; // ISO
  comments: { id: string; body: string; createdAt: string; author: { name: string } }[];
  /** Only passed on the portfolio-wide /complaints page, which spans
   * multiple projects — omitted on a project's own detail page since it's
   * already scoped and the label would be redundant. */
  project?: { seq: number; brand: string; location: string };
};

type PersonOption = { id: string; name: string };

export function ComplaintCard({
  complaint,
  projectId,
  canAct,
  canAssign,
  people,
  returnPath,
}: {
  complaint: ComplaintCardData;
  projectId: string;
  /** Can update status / add comments. */
  canAct: boolean;
  /** Narrower than canAct — only department owners (see canManageComplaintCategory). */
  canAssign: boolean;
  people: PersonOption[];
  returnPath?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const redirectTo = returnPath ?? `/projects/${projectId}`;

  const [statusState, statusFormAction, statusPending] = useActionState<ActionState, FormData>(
    updateComplaintStatus.bind(null, complaint.id, projectId, redirectTo),
    undefined
  );
  const [assignState, assignFormAction, assignPending] = useActionState<ActionState, FormData>(
    assignComplaint.bind(null, complaint.id, projectId, redirectTo),
    undefined
  );
  const [commentState, commentFormAction, commentPending] = useActionState<ActionState, FormData>(
    addComplaintComment.bind(null, complaint.id, projectId, redirectTo),
    undefined
  );

  return (
    <div id={`complaint-${complaint.id}`} className="scroll-mt-16 rounded-lg bg-card p-4 space-y-3 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{formatComplaintCode(complaint.seq)}</span>
            <span className="font-medium">{complaint.subject}</span>
            {complaint.project && (
              <Badge variant="outline">
                {formatProjectCode(complaint.project.seq)} — {complaint.project.brand} {complaint.project.location}
              </Badge>
            )}
            <Badge variant="outline">{COMPLAINT_CATEGORY_LABELS[complaint.category]}</Badge>
            <Badge variant="outline" className={TASK_PRIORITY_BADGE_CLASS[complaint.priority]}>
              {TASK_PRIORITY_LABELS[complaint.priority]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{complaint.description}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Raised by: {complaint.raisedBy.name}</span>
            <span>Assigned to: {complaint.assignedTo?.name ?? "Unassigned"}</span>
            <span>Raised: {formatDate(complaint.createdAt)}</span>
            {complaint.resolutionDate && <span>Resolved: {formatDate(complaint.resolutionDate)}</span>}
          </dl>
          {complaint.attachmentFileName && (
            <p className="mt-1 text-xs">
              <a
                href={`/projects/${projectId}/complaints/${complaint.id}/attachment`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {complaint.attachmentFileName}
              </a>
            </p>
          )}
        </div>
        <Badge variant="outline" className={COMPLAINT_STATUS_BADGE_CLASS[complaint.status]}>
          {COMPLAINT_STATUS_LABELS[complaint.status]}
        </Badge>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground hover:text-foreground"
      >
        <span className={cn("inline-block transition-transform", expanded && "rotate-90")}>▸</span>
        {expanded ? "Hide" : canAct ? "Update status / comment" : "Comment"}
        {complaint.comments.length > 0 &&
          ` · ${complaint.comments.length} comment${complaint.comments.length === 1 ? "" : "s"}`}
      </button>

      {expanded && (
        <>
          {canAct && (
            <form action={statusFormAction} className="flex flex-wrap items-end gap-2">
              <Select name="status" defaultValue={complaint.status}>
                <SelectTrigger className="h-8 w-full sm:w-[200px]">
                  <SelectValue>
                    {(value: ComplaintStatus | null) => (value ? COMPLAINT_STATUS_LABELS[value] : "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {COMPLAINT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>
                {statusPending ? "Saving…" : "Update status"}
              </Button>
              {statusState?.error && <p className="w-full text-xs text-destructive">{statusState.error}</p>}
            </form>
          )}

          {canAssign && (
            <form action={assignFormAction} className="flex flex-wrap items-end gap-2">
              <Select name="assignedToId" defaultValue={complaint.assignedTo?.id}>
                <SelectTrigger className="h-8 w-full sm:w-[200px]">
                  <SelectValue placeholder="Assign to…">
                    {(value: string | null) => people.find((p) => p.id === value)?.name ?? "Assign to…"}
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
              <Button type="submit" size="sm" variant="secondary" disabled={assignPending}>
                {assignPending ? "Saving…" : "Assign"}
              </Button>
              {assignState?.error && <p className="w-full text-xs text-destructive">{assignState.error}</p>}
            </form>
          )}

          <div className="space-y-2">
            {complaint.comments.length > 0 && (
              <ul className="space-y-1.5">
                {complaint.comments.map((c) => (
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
            {commentState?.error && <p className="text-xs text-destructive">{commentState.error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
