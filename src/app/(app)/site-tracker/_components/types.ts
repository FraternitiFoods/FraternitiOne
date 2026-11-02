export type TrackerStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";

export type StatusCounts = {
  notStarted: number;
  inProgress: number;
  completed: number;
  notRequired: number;
  total: number;
};

export type EvidenceItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "IMAGE" | "VIDEO";
  createdAt: string;
};

export type StepRowData = {
  id: string;
  code: string;
  name: string;
  order: number;
  synthetic: boolean;
  sectionId: string;
  siteStepId: string | null;
  status: TrackerStatus;
  assignee: string | null;
  remark: string | null;
  notRequiredReason: string | null;
  completedAt: string | null;
  completedByName: string | null;
  legacyCompleted: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  evidence: EvidenceItem[];
};

export type SectionData = {
  id: string;
  name: string;
  order: number;
  steps: StepRowData[];
};

export type SiteSummary = {
  site: { id: string; name: string };
  counts: StatusCounts;
  progressPercent: number;
  sections: SectionData[];
};

export type SiteProgressRow = {
  site: { id: string; name: string };
  counts: StatusCounts;
  progressPercent: number;
};

export const STATUS_LABELS: Record<TrackerStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NOT_REQUIRED: "Not required",
};

/** site-tracker-plan.md section 6 colors. */
export const STATUS_BADGE_CLASSES: Record<TrackerStatus, string> = {
  NOT_STARTED: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  NOT_REQUIRED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export const STATUS_BAR_CLASSES: Record<TrackerStatus, string> = {
  NOT_STARTED: "bg-muted-foreground/40",
  IN_PROGRESS: "bg-amber-500",
  COMPLETED: "bg-emerald-500",
  NOT_REQUIRED: "bg-slate-400",
};
