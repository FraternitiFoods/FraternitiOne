import type { Role, Department } from "@prisma/client";

/**
 * Role -> Department(s) mapping (SRD section 2 "User Roles and Permissions",
 * cross-checked against section 5's per-module bullets — see the fuller
 * rationale in permissions.ts, which owns access-control use of this map).
 *
 * Lives in its own file, without `server-only`, so the admin "New User" form
 * (a Client Component) can import it to show "this role manages: ..." without
 * pulling permissions.ts (and its server-only guard) into the client bundle.
 */
export const DEPARTMENT_OWNERS: Record<Role, Department[]> = {
  FRANCHISEE: ["FRANCHISEE"],
  SALES: ["SALES"],
  LEGAL: ["LEGAL", "PROPERTY"],
  INTERIORS: ["INTERIORS"],
  PROJECT_MANAGER: ["PROJECTS"],
  ACCOUNTS: ["ACCOUNTS"],
  HR: ["HR"],
  CULINARY: ["CULINARY", "PROCUREMENT"],
  MARKETING: ["MARKETING"],
  OPERATIONS: ["OPERATIONS"],
  MANAGEMENT: [],
  ADMIN: [],
  // Deliberately empty: a SITE_SUPERVISOR's access is scoped by
  // ProjectMember (plan.md section 16), not this role->department matrix —
  // a supervisor spans every BOQ trade on their assigned site, not one
  // department.
  SITE_SUPERVISOR: [],
  // Deliberately empty, same reasoning as SITE_SUPERVISOR: these three roles
  // (plan.md section 17) are scoped by the onboarding-specific permission
  // functions in permissions.ts (canReviewKyc, canPrepareLoi, canCompanySign),
  // not this department matrix. ACCOUNTS (existing role, reused for payment
  // review per section 17) already has its own entry above.
  KYC_REVIEWER: [],
  LOI_PREPARER: [],
  COMPANY_SIGNATORY: [],
};
