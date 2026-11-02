import { trackerProgressPercent } from "@/lib/tracker-calc";
import type { SectionData, SiteSummary, StatusCounts, StepRowData } from "./types";

export function findStep(summary: SiteSummary, stepId: string): StepRowData | undefined {
  for (const section of summary.sections) {
    const step = section.steps.find((s) => s.id === stepId);
    if (step) return step;
  }
  return undefined;
}

function countStatuses(sections: SectionData[]): StatusCounts {
  const counts: StatusCounts = { notStarted: 0, inProgress: 0, completed: 0, notRequired: 0, total: 0 };
  for (const section of sections) {
    for (const step of section.steps) {
      counts.total += 1;
      if (step.status === "NOT_STARTED") counts.notStarted += 1;
      else if (step.status === "IN_PROGRESS") counts.inProgress += 1;
      else if (step.status === "COMPLETED") counts.completed += 1;
      else counts.notRequired += 1;
    }
  }
  return counts;
}

/** Replaces one step in place and recomputes counts/progress — the same formula tracker-data.ts uses server-side, reused here so optimistic updates never drift from the real rule. */
export function applyStepUpdate(summary: SiteSummary, stepId: string, newStep: StepRowData): SiteSummary {
  const sections = summary.sections.map((section) => ({
    ...section,
    steps: section.steps.map((s) => (s.id === stepId ? newStep : s)),
  }));
  const counts = countStatuses(sections);
  const progressPercent = trackerProgressPercent({
    completed: counts.completed,
    notRequired: counts.notRequired,
    totalSteps: counts.total,
  });
  return { ...summary, sections, counts, progressPercent };
}

/** site-tracker-plan.md section 6: "Open by default: first section that is not 100%." */
export function computeDefaultOpenSection(summary: SiteSummary): Set<string> {
  for (const section of summary.sections) {
    if (section.steps.length === 0) continue;
    const completed = section.steps.filter((s) => s.status === "COMPLETED").length;
    const notRequired = section.steps.filter((s) => s.status === "NOT_REQUIRED").length;
    const denominator = section.steps.length - notRequired;
    const percent = denominator > 0 ? (completed / denominator) * 100 : 100;
    if (percent < 100) return new Set([section.id]);
  }
  return new Set();
}
