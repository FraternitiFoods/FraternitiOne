import "server-only";

import type { CurrentUser } from "@/lib/session";
import {
  BOQ_EDIT_ROLES,
  BOQ_VIEW_ROLES,
  OPS_BOQ_EDIT_ROLES,
  PO_ROLES,
  TRACKER_EDIT_ROLES,
  isExternalRole,
} from "@/lib/role-access";

/**
 * RBAC for this branch. The role -> module matrix is plan.md section 12 and
 * its role sets live in role-access.ts (also used by the sidebar). Site BOQ's
 * Admin-only rows are plan.md section 5:
 *   | Action                                              | Admin | Other roles |
 *   | Edit items, vendor rates, final vendor, add items    | yes   | no          |
 *   | Edit vendors, sites, settings, flip mode             | yes   | no          |
 *   | Lock / unlock a site                                 | yes   | no          |
 * "External" is just FRANCHISEE (plan.md section 2). Every function here is a
 * pure role check — mode gating and the Site lock gate live in
 * site-boq-write-guard.ts and are composed on top of these in each Server
 * Action. Per-user Dashboard task assignments are not role checks; see
 * dashboard-access.ts.
 */

/**
 * Creating/listing user accounts is scoped to ADMIN only.
 */
export function canManageUsers(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Site BOQ is limited to procurement / site-execution / money roles
 * (plan.md section 12, BOQ_VIEW_ROLES): every /site-boq/* page must 403
 * everyone else (FRANCHISEE, Marketing, Sales, Legal, HR, Culinary).
 */
export function canViewSiteBoq(user: Pick<CurrentUser, "role">): boolean {
  return BOQ_VIEW_ROLES.includes(user.role);
}

/**
 * SiteItem.qty / remarkSize and the order-tracking fields (poAmount, boqLink,
 * poLink, approvedVia, link, advanceGiven, stage, followUp, remarks).
 * BOQ_EDIT_ROLES: Admin, Operations, Project Manager, Interiors. Accounts and
 * Management can view Site BOQ but not edit it (plan.md section 12).
 */
export function canEditSiteItemTracking(user: Pick<CurrentUser, "role">): boolean {
  return BOQ_EDIT_ROLES.includes(user.role);
}

/**
 * Items (name/size/note), vendor rates and an item's final vendor, including
 * adding new items — row 3, Admin only. SiteItem.rateOverride is schema-only
 * for now (plan.md section 3: "the UI/data model must support a site-specific
 * override later") and has no edit path yet, so it isn't gated here.
 */
export function canEditItems(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Vendor contact details (name, address, GSTIN, phone, email, note) — row 4, Admin only. */
export function canEditVendors(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Sites: add, rename, opening date, short code, hide — row 4, Admin only. */
export function canEditSites(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Company details, PO defaults/terms, urgency thresholds — row 4, Admin only. */
export function canEditSettings(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Flipping app_settings.mode — row 4, Admin only. */
export function canFlipMode(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Viewing the audit log (Settings → recent edits) — Admin only, same row as settings. */
export function canViewAuditLog(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Lock / unlock a site — row 6, Admin only, in either mode (see site-boq-write-guard.ts: lock/unlock bypasses the mode gate entirely). */
export function canLockSite(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** docs/sheet-sync/CLAUDE_CODE_HANDOFF.md section 3: "admin button (session auth, admin role only)" for POST /api/sheet-sync/request. */
export function canTriggerSheetSync(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * SiteItem.rateOverride — the per-site rate override plan.md section 3 called
 * out as "the UI/data model must support a site-specific override later."
 * Admin only, same actor as canEditItems but kept as its own function since
 * it's a SiteItem field (per site+item), not an Item field.
 */
export function canEditRateOverride(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Create/download Purchase Orders — PO_ROLES: the Site BOQ editors plus
 * Accounts (plan.md section 12). Management is view-only.
 */
export function canCreatePo(user: Pick<CurrentUser, "role">): boolean {
  return PO_ROLES.includes(user.role);
}

/**
 * Site Tracker (site-tracker-plan.md section 4, rule 6): every internal role
 * can view it (all sites); external roles get no sidebar item and a 403 on
 * pages and APIs.
 */
export function canViewSiteTracker(user: Pick<CurrentUser, "role">): boolean {
  return !isExternalRole(user.role);
}

/**
 * Status/assignee/remark/evidence-add edits — TRACKER_EDIT_ROLES: Admin,
 * Operations, Project Manager, Interiors (plan.md section 12). Every other
 * internal role is view-only; this supersedes site-tracker-plan.md section 4
 * rule 6 for edits.
 */
export function canEditSiteTracker(user: Pick<CurrentUser, "role">): boolean {
  return TRACKER_EDIT_ROLES.includes(user.role);
}

/** Evidence delete — site-tracker-plan.md section 4, rule 3: "Admin only." */
export function canDeleteTrackerEvidence(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Dashboard (dashboard-sheet-sync-plan.md section 2): internal roles see
 * every site; a FRANCHISEE sees only their own assigned site (enforced by
 * the page/query, not by hiding the module — a franchisee with no
 * assignment yet sees an empty state, not a 403).
 */
export function canViewAllDashboardSites(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/**
 * "Sync with sheet" button — dashboard-sheet-sync-plan.md section 6/0:
 * "internal roles only", unlike Site BOQ's sync button which is Admin-only
 * (canTriggerSheetSync). Kept as its own function since the role set
 * genuinely differs between the two modules' sync buttons.
 */
export function canTriggerDashboardSync(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/** Creating a Dashboard site on the website (with the 402-step template) — Admin only. */
export function canCreateDashboardSite(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Editing a website-created Dashboard site's details and step status/remark — Admin only. */
export function canEditDashboardSite(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Permanently deleting a website-created Dashboard site (and its linked Tracker/BOQ/Operations BOQ data) - Admin only. */
export function canDeleteDashboardSite(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/** Assigning a Dashboard site to a franchisee user — dashboard-sheet-sync-plan.md section 2: "Admin assigns a site to a franchisee user inside the website." */
export function canManageDashboardSiteAssignment(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Operations BOQ (operations-boq-handoff.md section 7): same visibility as
 * Site BOQ (BOQ_VIEW_ROLES, plan.md section 12). Everyone else has no sidebar
 * item, a 403 on the page and is refused in every action.
 */
export function canViewOpsBoq(user: Pick<CurrentUser, "role">): boolean {
  return BOQ_VIEW_ROLES.includes(user.role);
}

/**
 * Edit any Operations BOQ cell, add a row, rename/delete an added row — Admin
 * and the existing OPERATIONS role only (the doc's "new Operations role" already
 * exists in the Role enum). Other roles that can view are read-only.
 */
export function canEditOpsBoq(user: Pick<CurrentUser, "role">): boolean {
  return OPS_BOQ_EDIT_ROLES.includes(user.role);
}

/**
 * Assigning people to Dashboard tasks (the "Team" page of a website-created
 * site) — Admin only (plan.md section 12). What an assigned person can then
 * open/edit is decided per task in dashboard-access.ts.
 */
export function canAssignDashboardTasks(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}
