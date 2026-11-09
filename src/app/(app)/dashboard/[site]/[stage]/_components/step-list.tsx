"use client";

import { useState } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import type { StepNode } from "@/lib/dashboard-data";

const STATUS_LABEL: Record<StepNode["status"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NOT_REQUIRED: "Not required",
};

const STATUS_CLASS: Record<StepNode["status"], string> = {
  NOT_STARTED: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-amber-500/15 text-amber-500",
  COMPLETED: "bg-emerald-500/15 text-emerald-500",
  NOT_REQUIRED: "bg-muted text-muted-foreground/60",
};

/** Stage page step list (dashboard-sheet-sync-plan.md section 6): parent steps expandable (+/-), "Not required" dimmed. */
export function StepList({ steps }: { steps: StepNode[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} depth={0} />
      ))}
    </div>
  );
}

function StepRow({ step, depth }: { step: StepNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = step.children.length > 0;
  const dimmed = step.status === "NOT_REQUIRED";

  return (
    <div className="border-b last:border-b-0">
      <div className={cn("flex items-start gap-3 py-3 pr-4", dimmed && "opacity-50")} style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-sm text-muted-foreground hover:bg-muted"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{step.label}</span>
            <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[step.status])}>
              {STATUS_LABEL[step.status]}
            </Badge>
            {step.shared && <Badge variant="outline">Shared</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {step.assignedTo && <span>Assigned: {step.assignedTo}</span>}
            {step.remark && <span>Remark: {step.remark}</span>}
          </div>
          {step.deliverables.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {step.deliverables.map((d, i) => (
                <a
                  key={i}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-primary hover:underline"
                >
                  {d.name} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {hasChildren && open && (
        <div>
          {step.children.map((child) => (
            <StepRow key={child.id} step={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
