import type {
  Role,
  Department,
  LifecycleStage,
  ProjectHealth,
  TaskStatus,
  TaskPriority,
  DocumentStatus,
} from "@prisma/client";

/** "FR-00001" style human-readable code from FranchiseProject.seq. */
export function formatProjectCode(seq: number): string {
  return `FR-${String(seq).padStart(5, "0")}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Whole days from now until `date` (negative if it's in the past). A plain
 * module-level helper — not a component/hook — so the `Date.now()` call
 * inside it doesn't trip eslint-plugin-react-hooks' purity rule the way a
 * direct `Date.now()` call in a Server Component's render body would.
 */
export function daysUntil(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** 1536000 -> "1.5 MB". Used for Document.fileSize. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** SCREAMING_SNAKE_CASE enum value -> "Title Case" for display. */
export function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * "FranchiseProject" -> "Franchise Project" — for AuditEvent.entityType,
 * which is stored as a PascalCase model name (see writeAuditEvent call
 * sites), not a SCREAMING_SNAKE_CASE enum value like `humanize` expects.
 */
export function splitPascalCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export const ROLE_LABELS: Record<Role, string> = {
  FRANCHISEE: "Franchisee",
  SALES: "Sales",
  LEGAL: "Legal",
  INTERIORS: "Interiors",
  PROJECT_MANAGER: "Project Manager",
  ACCOUNTS: "Accounts",
  HR: "HR",
  CULINARY: "Culinary",
  MARKETING: "Marketing",
  OPERATIONS: "Operations",
  MANAGEMENT: "Management",
  ADMIN: "System Admin",
};

export const DEPARTMENT_LABELS: Record<Department, string> = {
  SALES: "Sales",
  LEGAL: "Legal",
  PROPERTY: "Property / Site",
  INTERIORS: "Interiors & Design",
  PROJECTS: "Project Execution",
  ACCOUNTS: "Accounts",
  HR: "HR",
  CULINARY: "Culinary",
  PROCUREMENT: "Procurement",
  MARKETING: "Marketing",
  OPERATIONS: "Operations",
  FRANCHISEE: "Franchisee",
  GENERAL: "General",
};

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  SALES_LOI: "Sales & LOI",
  LEGAL_COMPLIANCE: "Legal & Compliance",
  PROPERTY_SITE: "Property / Site",
  INTERIORS_DESIGN: "Interiors & Design",
  PROJECT_EXECUTION: "Project Execution",
  ACCOUNTS: "Accounts",
  HR: "HR",
  CULINARY_PROCUREMENT: "Culinary & Procurement",
  MARKETING: "Marketing",
  PRE_OPENING_READINESS: "Pre-Opening Readiness",
  TRAINING_TRIAL_RUNS: "Training & Trial Runs",
  GRAND_OPENING: "Grand Opening",
  POST_OPENING_TRANSITION: "Post-Opening Transition",
};

/** Ordered main path, for a simple "stage N of 13" style progress hint. */
export const LIFECYCLE_STAGE_ORDER: LifecycleStage[] = [
  "SALES_LOI",
  "LEGAL_COMPLIANCE",
  "PROPERTY_SITE",
  "INTERIORS_DESIGN",
  "PROJECT_EXECUTION",
  "ACCOUNTS",
  "HR",
  "CULINARY_PROCUREMENT",
  "MARKETING",
  "PRE_OPENING_READINESS",
  "TRAINING_TRIAL_RUNS",
  "GRAND_OPENING",
  "POST_OPENING_TRANSITION",
];

export const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = {
  GREEN: "Green",
  AMBER: "Amber",
  RED: "Red",
  CRITICAL: "Critical",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  AWAITING_FRANCHISEE: "Awaiting Franchisee",
  AWAITING_INTERNAL: "Awaiting Internal",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: "Draft",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  SUPERSEDED: "Superseded",
};
