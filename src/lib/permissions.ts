import "server-only";

import type { Role, Department } from "@prisma/client";
import type { CurrentUser } from "@/lib/session";
import { DEPARTMENT_OWNERS } from "@/lib/role-departments";

/**
 * Phase 1 RBAC — role-based, module-level (plan.md section 5 decision: "no
 * field-level rules yet"). This is a hardcoded matrix, not an admin-editable
 * one — SRD section 14 ("Admin & Master Configuration: department, role,
 * permission and user management") is explicitly out of Phase 1 scope
 * (plan.md section 3 FR list has no Admin/master-config FR).
 *
 * The role -> department mapping (DEPARTMENT_OWNERS, reconstructed from SRD
 * section 2's "User Roles and Permissions" table, cross-checked against the
 * per-module bullets in section 5) lives in role-departments.ts rather than
 * here, so the admin "New User" form (a Client Component) can display it
 * without importing this server-only file.
 *
 * Any change to who-can-do-what for a given department belongs here, not
 * scattered through page/action code.
 */

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

/**
 * Creating/listing user accounts is scoped to ADMIN only — narrower than
 * `hasFullOverride` (which also grants MANAGEMENT broad task/document
 * access). Account provisioning is a system-administration action, not a
 * cross-department override, so it isn't extended to MANAGEMENT here.
 */
export function canManageUsers(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

export function canEditProjectHeader(user: Pick<CurrentUser, "role">): boolean {
  return (
    PROJECT_HEADER_EDITOR_ROLES.includes(user.role) || hasFullOverride(user)
  );
}

/**
 * Force a lifecycle stage to "Completed" even with open tasks. Deliberately
 * narrower than `hasFullOverride` (Admin only, not Management) — this is a
 * business call to skip the normal completion criteria, not a general
 * cross-department access grant.
 */
export function canForceCompleteStage(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Deleting a FranchiseProject cascades its entire task/document/stage-override
 * history (see schema.prisma's `onDelete: Cascade` on those relations) — the
 * most destructive action in the app. Scoped to ADMIN only, same as
 * `canManageUsers`/`canForceCompleteStage`, not extended to MANAGEMENT via
 * `hasFullOverride`. Not asked for explicitly which roles beyond "admin"
 * should get this — narrowest reasonable default, flagged in plan.md.
 */
export function canDeleteProject(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
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

/**
 * Shared by `canManageTaskModule` and `canManageDocumentCategory` — both
 * Task.module and Document.category are the same `Department` enum (see
 * schema.prisma), and plan.md section 5's "role-based, module-level" Phase 1
 * decision applies identically to both, so there's one matrix, not two.
 */
function ownsDepartment(user: Pick<CurrentUser, "role">, department: Department): boolean {
  if (hasFullOverride(user)) return true;
  return DEPARTMENT_OWNERS[user.role]?.includes(department) ?? false;
}

/** Can this user create/edit tasks whose module is `department`? */
export function canManageTaskModule(
  user: Pick<CurrentUser, "role">,
  department: Department
): boolean {
  return ownsDepartment(user, department);
}

/** Can this user upload/manage documents in this category (FR-005)? */
export function canManageDocumentCategory(
  user: Pick<CurrentUser, "role">,
  category: Department
): boolean {
  return ownsDepartment(user, category);
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

/**
 * Gate for document mutations (new version, status change) — mirrors
 * `canActOnTask`'s shape exactly. Viewing/downloading a document that's
 * already on a project the user can see (`canViewProject`) is intentionally
 * NOT gated further by category — internal roles already see every
 * department's tasks on a project they can view (see `canViewProject`'s own
 * comment), and the SRD only specifies "access controlled by project and
 * role" for the vault (section 5), not per-category read walls.
 */
export function canActOnDocument(
  user: Pick<CurrentUser, "role" | "id">,
  document: { ownerId: string; category: Department },
  project: { franchiseeId: string }
): boolean {
  if (canManageDocumentCategory(user, document.category)) return true;
  if (document.ownerId === user.id) return true;
  if (user.role === "FRANCHISEE" && project.franchiseeId === user.id) return true;
  return false;
}
