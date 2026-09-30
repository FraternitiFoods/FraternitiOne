import type { ComplaintCategory, Department } from "@prisma/client";

/**
 * Maps each Complaint category to the Department that owns handling it —
 * reuses the exact same ownsDepartment() RBAC check that already gates
 * Task.module/Document.category (permissions.ts) instead of a new
 * permission matrix. Not a documented mapping anywhere (the source SRD
 * doesn't define departments) — a best-effort inference, easy to adjust in
 * this one file if a category should sit with a different team.
 */
export const COMPLAINT_CATEGORY_DEPARTMENT: Record<ComplaintCategory, Department> = {
  PROJECT: "PROJECTS",
  CONSTRUCTION: "PROJECTS",
  INTERIOR: "INTERIORS",
  EQUIPMENT: "PROCUREMENT",
  SALES: "SALES",
  BILLING: "ACCOUNTS",
  DOCUMENTATION: "LEGAL",
  SUPPORT: "OPERATIONS",
  OTHER: "GENERAL",
};

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
  "PROJECT",
  "CONSTRUCTION",
  "INTERIOR",
  "EQUIPMENT",
  "SALES",
  "BILLING",
  "DOCUMENTATION",
  "SUPPORT",
  "OTHER",
];
