"use client";

import { useRef, useState } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { StepNode } from "@/lib/dashboard-data";
import { STEP_REMARK_MAX } from "@/lib/dashboard-site-input";
import { updateDashboardStep } from "../../../actions";

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

const STATUS_ORDER: StepNode["status"][] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"];

const FIELD_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60";

/** Who may edit what on this page (decided server-side in the page, plan.md section 12) — the UI only reflects it. */
type StepAccess = { editAll: boolean; editable: ReadonlySet<string>; mine: ReadonlySet<string> };

/**
 * Stage page step list (dashboard-sheet-sync-plan.md section 6): parent steps expandable (+/-), "Not required" dimmed.
 * A leaf gets a status select + remark box when `editAll` (Admin on a website-created site) or its id is in
 * `editableStepIds` (the signed-in user's own assigned tasks). `highlightStepIds` marks those tasks as "yours".
 * The Server Action re-checks every save, so these props are display-only.
 */
export function StepList({
  steps,
  editAll = false,
  editableStepIds = [],
  highlightStepIds = [],
}: {
  steps: StepNode[];
  editAll?: boolean;
  editableStepIds?: string[];
  highlightStepIds?: string[];
}) {
  const access: StepAccess = {
    editAll,
    editable: new Set(editableStepIds),
    mine: new Set(highlightStepIds),
  };
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} depth={0} access={access} />
      ))}
    </div>
  );
}

function StepRow({ step, depth, access }: { step: StepNode; depth: number; access: StepAccess }) {
  const [open, setOpen] = useState(true);
  const hasChildren = step.children.length > 0;
  const canEditThis = !step.isParent && (access.editAll || access.editable.has(step.id));
  const isMine = !step.isParent && access.mine.has(step.id);
  // Real assignees (Admin's Team page) win over the legacy free-text label, which defaults to "Admin" on new sites.
  const assignedLabel = step.assignees.length > 0 ? step.assignees.map((a) => a.name).join(", ") : step.assignedTo;

  // Optimistic local copy: the UI changes instantly, the Server Action runs in
  // the background, and a rejected save rolls back to the last saved values.
  const [status, setStatus] = useState(step.status);
  const [remark, setRemark] = useState(step.remark ?? "");
  const saved = useRef({ status: step.status, remark: step.remark ?? "" });
  const [saving, setSaving] = useState(false);

  async function save(next: { status: StepNode["status"]; remark: string }) {
    if (next.status === saved.current.status && next.remark.trim() === saved.current.remark.trim()) return;
    setSaving(true);
    try {
      const result = await updateDashboardStep(step.id, next.status, next.remark);
      if (result?.error) throw new Error(result.error);
      saved.current = { status: next.status, remark: next.remark.trim() };
    } catch (e) {
      setStatus(saved.current.status);
      setRemark(saved.current.remark);
      toast.error(e instanceof Error && e.message ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const shownStatus = canEditThis ? status : step.status;
  const dimmed = shownStatus === "NOT_REQUIRED";

  return (
    <div className={cn("border-b last:border-b-0", isMine && "border-l-4 border-l-sky-500 bg-sky-500/5")} data-mine={isMine ? "true" : undefined}>
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
            <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[shownStatus])}>
              {STATUS_LABEL[shownStatus]}
            </Badge>
            {step.shared && <Badge variant="outline">Shared</Badge>}
            {isMine && (
              <Badge variant="outline" className="border-transparent bg-sky-500/15 text-sky-500">
                Assigned to you
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {assignedLabel && <span>Assigned: {assignedLabel}</span>}
            {!canEditThis && step.remark && <span>Remark: {step.remark}</span>}
          </div>
          {canEditThis && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <select
                aria-label={`Status of ${step.label}`}
                className={FIELD_CLASS}
                value={status}
                disabled={saving}
                onChange={(e) => {
                  const nextStatus = e.target.value as StepNode["status"];
                  setStatus(nextStatus);
                  void save({ status: nextStatus, remark });
                }}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Remark for ${step.label}`}
                className={cn(FIELD_CLASS, "min-w-40 flex-1")}
                placeholder="Remark"
                maxLength={STEP_REMARK_MAX}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                onBlur={() => void save({ status, remark })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
          )}
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
            <StepRow key={child.id} step={child} depth={depth + 1} access={access} />
          ))}
        </div>
      )}
    </div>
  );
}
