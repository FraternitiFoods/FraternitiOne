"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "cn";
import { formatDateTime } from "@/lib/format";
import { StatusSelect } from "./status-select";
import { InlineTextField } from "./inline-text-field";
import { EvidenceDialog } from "./evidence-dialog";
import type { EvidenceItem, StepRowData, TrackerStatus } from "./types";

export function StepRow({
  siteId,
  step,
  canEdit,
  isAdmin,
  onStatusChange,
  onFieldSave,
  onEvidenceChange,
  onConfirmCompleted,
}: {
  siteId: string;
  step: StepRowData;
  canEdit: boolean;
  isAdmin: boolean;
  onStatusChange: (stepId: string, status: TrackerStatus) => void;
  onFieldSave: (stepId: string, field: "assignee" | "remark" | "notRequiredReason", value: string | null) => void;
  onEvidenceChange: (stepId: string, evidence: EvidenceItem[]) => void;
  onConfirmCompleted: (stepId: string) => Promise<boolean>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState(false);

  function handleStatusChange(status: TrackerStatus) {
    if (status === "COMPLETED" && !step.legacyCompleted && step.evidence.length === 0) {
      setPendingCompletion(true);
      setDialogOpen(true);
      return;
    }
    onStatusChange(step.id, status);
  }

  const lastUpdated = step.completedAt ?? step.updatedAt;
  const lastUpdatedByName = step.status === "COMPLETED" ? step.completedByName ?? step.updatedByName : step.updatedByName;

  return (
    <div
      data-step-code={step.code}
      data-step-status={step.status}
      className={cn(
        "flex flex-col gap-2 border-b px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-3",
        step.status === "COMPLETED" && "bg-emerald-50/40 dark:bg-emerald-950/10"
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs text-muted-foreground">{step.code}</span>{" "}
        <span className="text-sm">{step.name}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <StatusSelect value={step.status} disabled={!canEdit} onChange={handleStatusChange} />

        {step.status === "NOT_REQUIRED" && (
          <InlineTextField
            value={step.notRequiredReason}
            placeholder="Reason (optional)"
            disabled={!canEdit}
            className="w-36"
            onSave={(value) => onFieldSave(step.id, "notRequiredReason", value)}
          />
        )}

        <InlineTextField
          value={step.assignee}
          placeholder="Assignee"
          disabled={!canEdit}
          className="w-28"
          onSave={(value) => onFieldSave(step.id, "assignee", value)}
        />

        <InlineTextField
          value={step.remark}
          placeholder="Remark"
          disabled={!canEdit}
          className="w-36"
          onSave={(value) => onFieldSave(step.id, "remark", value)}
        />

        <button
          type="button"
          onClick={() => {
            setPendingCompletion(false);
            setDialogOpen(true);
          }}
          className="flex h-8 items-center gap-1 rounded-md border border-input px-2 text-xs text-muted-foreground hover:bg-accent"
        >
          <Camera className="size-3.5" />
          {step.evidence.length}
        </button>

        <span className="hidden text-[11px] text-muted-foreground lg:block">
          {lastUpdated ? (
            <>
              {lastUpdatedByName ?? "—"} · {formatDateTime(lastUpdated)}
            </>
          ) : (
            "—"
          )}
        </span>
      </div>

      <EvidenceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        siteId={siteId}
        step={step}
        canEdit={canEdit}
        canDelete={isAdmin}
        pendingCompletion={pendingCompletion}
        onEvidenceChange={onEvidenceChange}
        onConfirmCompleted={() => onConfirmCompleted(step.id)}
      />
    </div>
  );
}
