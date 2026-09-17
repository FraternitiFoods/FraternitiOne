import type {
  ProjectHealth,
  TaskStatus,
  TaskPriority,
  AuditAction,
  DocumentStatus,
} from "@prisma/client";

/**
 * Semantic colour classes for status pills across the app, matching the
 * SRD wireframe pack's colour language (green/amber/red health chips,
 * purple brand accent for "in progress"/primary states). Kept separate
 * from `format.ts` (which owns human-readable labels) so colour and text
 * can be reused/overridden independently.
 *
 * All values are meant to be passed as `className` on `<Badge variant="outline">`
 * — `outline` gives a transparent-border base that these bg/text utilities
 * cleanly override (via the `cn` package's tailwind-merge behaviour).
 */

export const HEALTH_BADGE_CLASS: Record<ProjectHealth, string> = {
  GREEN: "border-transparent bg-emerald-100 text-emerald-700",
  AMBER: "border-transparent bg-amber-100 text-amber-700",
  RED: "border-transparent bg-red-100 text-red-700",
  CRITICAL: "border-transparent bg-red-600 text-white",
};

export const TASK_STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  NOT_STARTED: "border-transparent bg-slate-100 text-slate-600",
  IN_PROGRESS: "border-transparent bg-blue-100 text-blue-700",
  AWAITING_FRANCHISEE: "border-transparent bg-amber-100 text-amber-700",
  AWAITING_INTERNAL: "border-transparent bg-amber-100 text-amber-700",
  BLOCKED: "border-transparent bg-red-100 text-red-700",
  COMPLETED: "border-transparent bg-emerald-100 text-emerald-700",
  CANCELLED: "border-transparent bg-slate-100 text-slate-400",
};

export const TASK_PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  LOW: "border-transparent bg-slate-100 text-slate-600",
  MEDIUM: "border-transparent bg-blue-100 text-blue-700",
  HIGH: "border-transparent bg-amber-100 text-amber-700",
  CRITICAL: "border-transparent bg-red-100 text-red-700",
};

export const DOCUMENT_STATUS_BADGE_CLASS: Record<DocumentStatus, string> = {
  DRAFT: "border-transparent bg-slate-100 text-slate-600",
  UNDER_REVIEW: "border-transparent bg-amber-100 text-amber-700",
  APPROVED: "border-transparent bg-emerald-100 text-emerald-700",
  REJECTED: "border-transparent bg-red-100 text-red-700",
  EXPIRED: "border-transparent bg-red-100 text-red-700",
  SUPERSEDED: "border-transparent bg-slate-100 text-slate-400",
};

export const AUDIT_ACTION_BADGE_CLASS: Record<AuditAction, string> = {
  CREATE: "border-transparent bg-emerald-100 text-emerald-700",
  UPDATE: "border-transparent bg-blue-100 text-blue-700",
  DELETE: "border-transparent bg-red-100 text-red-700",
  LOGIN: "border-transparent bg-slate-100 text-slate-600",
  LOGOUT: "border-transparent bg-slate-100 text-slate-600",
};
