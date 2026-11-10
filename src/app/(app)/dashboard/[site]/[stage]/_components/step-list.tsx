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

/**
 * Stage page step list (dashboard-sheet-sync-plan.md section 6): parent steps expandable (+/-), "Not required" dimmed.
 * `editable` (admin on a website-created site only) adds a status select + remark box to leaf steps.
 */
export function StepList({ steps, editable = false }: { steps: StepNode[]; editable?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} depth={0} editable={editable} />
      ))}
    </div>
  );
}

function StepRow({ step, depth, editable }: { step: StepNode; depth: number; editable: boolean }) {
  const [open, setOpen] = useState(true);
  const hasChildren = step.children.length > 0;
  const canEditThis = editable && !step.isParent;

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
            <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[shownStatus])}>
              {STATUS_LABEL[shownStatus]}
            </Badge>
            {step.shared && <Badge variant="outline">Shared</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {step.assignedTo && <span>Assigned: {step.assignedTo}</span>}
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
            <StepRow key={child.id} step={child} depth={depth + 1} editable={editable} />
          ))}
        </div>
      )}
    </div>
  );
}
