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
