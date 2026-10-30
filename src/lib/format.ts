import type { Role } from "@prisma/client";

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
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

/** 1536000 -> "1.5 MB". */
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
    timeZone: "Asia/Kolkata",
  });
}

/** SCREAMING_SNAKE_CASE enum value -> "Title Case" for display. */
export function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** "FranchiseProject" -> "Franchise Project" — for AuditEvent.entityType, which is
 * stored as a PascalCase model name (see writeAuditEvent call sites), not a
 * SCREAMING_SNAKE_CASE enum value like `humanize` expects. */
export function splitPascalCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Dashboards use 0 decimals, item tables use 2 (plan.md section 6.4). */
export function formatCurrency(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(value);
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
