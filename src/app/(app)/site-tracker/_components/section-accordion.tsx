"use client";

import { ChevronDown } from "lucide-react";
import { ProgressBar } from "./progress-bar";
import { StepRow } from "./step-row";
import type { EvidenceItem, SectionData, StepRowData, TrackerStatus } from "./types";

export function SectionAccordion({
  siteId,
  section,
  defaultOpen,
  canEdit,
  isAdmin,
  onStatusChange,
  onFieldSave,
  onEvidenceChange,
  onConfirmCompleted,
}: {
  siteId: string;
  section: SectionData;
  defaultOpen: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  onStatusChange: (stepId: string, status: TrackerStatus) => void;
  onFieldSave: (stepId: string, field: "assignee" | "remark" | "notRequiredReason", value: string | null) => void;
  onEvidenceChange: (stepId: string, evidence: EvidenceItem[]) => void;
  onConfirmCompleted: (stepId: string) => Promise<boolean>;
}) {
  if (section.steps.length === 0) return null;

  const completed = section.steps.filter((s) => s.status === "COMPLETED").length;
  const notRequired = section.steps.filter((s) => s.status === "NOT_REQUIRED").length;
  const total = section.steps.length;
  const denominator = total - notRequired;
  const percent = denominator > 0 ? (completed / denominator) * 100 : 0;

  return (
    <details
      data-section-name={section.name}
      className="group overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none">
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span className="min-w-0 flex-1 font-medium">{section.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {completed}/{total}
        </span>
        <ProgressBar percent={percent} className="hidden w-24 shrink-0 sm:block" />
      </summary>
      <div className="border-t">
        {section.steps.map((step: StepRowData) => (
          <StepRow
            key={step.id}
            siteId={siteId}
            step={step}
            canEdit={canEdit}
            isAdmin={isAdmin}
            onStatusChange={onStatusChange}
            onFieldSave={onFieldSave}
            onEvidenceChange={onEvidenceChange}
            onConfirmCompleted={onConfirmCompleted}
          />
        ))}
      </div>
    </details>
  );
}
