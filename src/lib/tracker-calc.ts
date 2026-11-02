/**
 * Site Tracker progress rule (site-tracker-plan.md section 1 and section 4
 * rule 5): "Progress % = Completed / (all steps - Not required)." Pure
 * function, no DB access, so the same rule applies identically wherever a
 * percentage is shown (summary card, All sites tab).
 */
export function trackerProgressPercent(params: {
  completed: number;
  notRequired: number;
  totalSteps: number;
}): number {
  const denominator = params.totalSteps - params.notRequired;
  if (denominator <= 0) return 0;
  return (params.completed / denominator) * 100;
}

/**
 * site-tracker-plan.md section 4 rule 1: "COMPLETED requires >= 1 evidence
 * ... unless legacyCompleted." Evidence is uploaded (and its TrackerEvidence
 * row created) in a separate request before the status PATCH, so by the
 * time this runs, "already stored" evidence is just the current count.
 */
export function canMarkCompleted(params: { evidenceCount: number; legacyCompleted: boolean }): boolean {
  return params.legacyCompleted || params.evidenceCount >= 1;
}

/**
 * site-tracker-plan.md section 4 rule 3: "Evidence delete: Admin only.
 * Cannot delete the last evidence of a COMPLETED, non-legacy step (change
 * status first)." The Admin-only part is a separate role check
 * (canDeleteTrackerEvidence in permissions.ts); this is just the structural
 * rule once Admin-ness is already established.
 */
export function canDeleteEvidence(params: {
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";
  legacyCompleted: boolean;
  evidenceCount: number;
}): boolean {
  if (params.status !== "COMPLETED" || params.legacyCompleted) return true;
  return params.evidenceCount > 1;
}
