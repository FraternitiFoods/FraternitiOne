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
};
