import "server-only";

import type { Role, Department } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";

/**
 * Phase 1 RBAC — role-based, module-level (plan.md section 5 decision: "no
 * field-level rules yet"). This is a hardcoded matrix, not an admin-editable
 * one — SRD section 14 ("Admin & Master Configuration: department, role,
 * permission and user management") is explicitly out of Phase 1 scope
 * (plan.md section 3 FR list has no Admin/master-config FR).
 *
 * The role -> department mapping below is reconstructed from SRD section 2's
 * "User Roles and Permissions" table, cross-checked against the per-module
 * bullets in section 5 (the extracted PDF table had its "Key Rights" column
 * shifted by one row; the mapping here is the corrected version — e.g. Sales'
 * actual right is "Create franchise record, upload LOI, commercial
 * handover", matching section 5's Sales & Onboarding bullets). Roles/rights
 * not tied to a specific department (Management, Admin) get broader access.
 *
 * Any change to who-can-do-what for a given department belongs here, not
 * scattered through page/action code.
 */
const DEPARTMENT_OWNERS: Record<Role, Department[]> = {
  FRANCHISEE: ["FRANCHISEE"],
  SALES: ["SALES"],
  // Legal's rights include "Lease/landlord diligence" (SRD section 5), which
  // is the Property/Site lifecycle stage's work — no dedicated Property role
  // exists in section 2, so it's grouped under Legal.
  LEGAL: ["LEGAL", "PROPERTY"],
  INTERIORS: ["INTERIORS"],
  PROJECT_MANAGER: ["PROJECTS"],
  ACCOUNTS: ["ACCOUNTS"],
  HR: ["HR"],
  // SRD groups "Culinary & Procurement" as one parallel lifecycle stage
  // (section 3, Stage 08); no separate Procurement role exists in section 2.
  CULINARY: ["CULINARY", "PROCUREMENT"],
  MARKETING: ["MARKETING"],
  OPERATIONS: ["OPERATIONS"],
  // Management/Admin overrides are handled by ROLES_WITH_FULL_OVERRIDE below,
  // not by listing every department here.
  MANAGEMENT: [],
  ADMIN: [],
};

/**
 * Management ("All projects, escalations, analytics, overrides with audit
 * log") and Admin (system administration) both get cross-department write
 * access for Phase 1. Every such override is still written to AuditEvent
 * like any other change (FR-010) — this is an access grant, not an audit
 * exemption.
 */
const ROLES_WITH_FULL_OVERRIDE: Role[] = ["MANAGEMENT", "ADMIN"];

/** Roles allowed to create a new FranchiseProject (FR-001: created at sales onboarding). */
const PROJECT_CREATOR_ROLES: Role[] = ["SALES", "MANAGEMENT", "ADMIN"];

/**
 * Roles allowed to edit the cross-cutting project header fields (lifecycle
 * stage, health, owner, next action) shown on the dashboard (FR-002). These
 * aren't owned by one department, so Phase 1 grants them to the roles
 * responsible for driving the project forward end-to-end.
 */
const PROJECT_HEADER_EDITOR_ROLES: Role[] = [
  "SALES",
  "PROJECT_MANAGER",
  "MANAGEMENT",
  "ADMIN",
];

export function hasFullOverride(user: Pick<CurrentUser, "role">): boolean {
  return ROLES_WITH_FULL_OVERRIDE.includes(user.role);
}

export function canCreateProject(user: Pick<CurrentUser, "role">): boolean {
  return PROJECT_CREATOR_ROLES.includes(user.role) || hasFullOverride(user);
}

export function canEditProjectHeader(user: Pick<CurrentUser, "role">): boolean {
  return (
    PROJECT_HEADER_EDITOR_ROLES.includes(user.role) || hasFullOverride(user)
  );
}

/**
 * Franchisees only see their own project(s) (NFR-04: "project-level data
 * isolation"); every internal role sees the full project list so they can
 * work their department's queue across active sites — this matches the
 * SRD's north-star ("internal teams must be able to answer who owns the
 * next action") which presumes cross-project visibility for staff.
 */
export function canViewProject(
  user: Pick<CurrentUser, "role" | "id">,
  project: { franchiseeId: string }
): boolean {
  if (user.role === "FRANCHISEE") {
    return project.franchiseeId === user.id;
  }
  return true;
}

/** Can this user create/edit tasks whose module is `department`? */
export function canManageTaskModule(
  user: Pick<CurrentUser, "role">,
  department: Department
): boolean {
  if (hasFullOverride(user)) return true;
  return DEPARTMENT_OWNERS[user.role]?.includes(department) ?? false;
}

/**
 * Every Department this user can create/manage tasks in — used to build the
 * module choices offered on the "New Task" form (permissions.ts is
 * server-only, so pages compute this list server-side and pass it down as
 * plain data to the client form rather than importing the matrix directly).
 */
const ALL_DEPARTMENTS: Department[] = [
  "SALES",
  "LEGAL",
  "PROPERTY",
  "INTERIORS",
  "PROJECTS",
  "ACCOUNTS",
  "HR",
  "CULINARY",
  "PROCUREMENT",
  "MARKETING",
  "OPERATIONS",
  "FRANCHISEE",
  "GENERAL",
];

export function getManageableModules(user: Pick<CurrentUser, "role">): Department[] {
  if (hasFullOverride(user)) return ALL_DEPARTMENTS;
  return DEPARTMENT_OWNERS[user.role] ?? [];
}

/**
 * Broader than `canManageTaskModule`: also true for the task's own
 * owner/creator, and for a franchisee on their own project — used to gate
 * status updates and comments on a specific task rather than task creation
 * in a module generally.
 */
export function canActOnTask(
  user: Pick<CurrentUser, "role" | "id">,
  task: { ownerId: string; createdById: string; module: Department },
  project: { franchiseeId: string }
): boolean {
  if (canManageTaskModule(user, task.module)) return true;
  if (task.ownerId === user.id || task.createdById === user.id) return true;
  if (user.role === "FRANCHISEE" && project.franchiseeId === user.id) return true;
  return false;
}
