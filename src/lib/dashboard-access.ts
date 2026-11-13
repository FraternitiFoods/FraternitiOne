import type { Role } from "@prisma/client";

/**
 * Who may open a Dashboard stage and edit a Dashboard step (plan.md section 12).
 * Pure on purpose (no DB, no `server-only`): the pages, the Server Action and
 * the unit tests all call these, and the data they need (assigned stage
 * numbers / "is this user assigned to this step") is loaded by the caller —
 * see getAssignedStageNos / isAssignedToStep in dashboard-data.ts.
 *
 * Model: Admin does everything; a FRANCHISEE only ever reads (and only on
 * their own assigned site, which the caller checks before asking us); every
 * other internal role can open a stage only if Admin gave them >= 1 task in
 * it, and edit only the tasks they were given. Assignments exist for
 * website-created sites only (see DashboardStepAssignment in schema.prisma).
 */

export type DashboardOrigin = "SHEET" | "WEBSITE";

/**
 * May this user open `/dashboard/<site>/<stage>`? For a FRANCHISEE the caller
 * has already verified the site is their own (getAssignedSiteName), so every
 * stage of it is readable, exactly as before this change.
 */
export function canOpenStage(args: {
  role: Role;
  stageNo: number;
  assignedStageNos: ReadonlySet<number>;
}): boolean {
  if (args.role === "ADMIN" || args.role === "FRANCHISEE") return true;
  return args.assignedStageNos.has(args.stageNo);
}

/**
 * May this user change this step's status/remark? Only on website-created
 * sites (sheet sites are overwritten by the next sync), never on a parent
 * row (its status is derived), never for a FRANCHISEE, and for everyone but
 * Admin only on a step assigned to them.
 */
export function canEditStep(args: {
  role: Role;
  origin: DashboardOrigin;
  isParent: boolean;
  isAssignedToStep: boolean;
}): boolean {
  if (args.origin !== "WEBSITE" || args.isParent) return false;
  if (args.role === "FRANCHISEE") return false;
  if (args.role === "ADMIN") return true;
  return args.isAssignedToStep;
}

/** Stage cards on the site page: openable ones are links, the rest are shown locked (progress still visible). */
export function openableStageNos(args: {
  role: Role;
  allStageNos: readonly number[];
  assignedStageNos: ReadonlySet<number>;
}): Set<number> {
  return new Set(
    args.allStageNos.filter((stageNo) =>
      canOpenStage({ role: args.role, stageNo, assignedStageNos: args.assignedStageNos })
    )
  );
}
