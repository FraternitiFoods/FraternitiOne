import "server-only";

import type { CurrentUser } from "@/lib/session";

/**
 * RBAC for this branch. Site BOQ's role matrix is plan.md section 5:
 *   | Action                                              | Admin | Other internal | External |
 *   | View all Site BOQ screens                           | yes   | yes             | no       |
 *   | Edit qty, remark/size, order-tracking fields         | yes   | yes             | no       |
 *   | Edit items, vendor rates, final vendor, add items    | yes   | no              | no       |
 *   | Edit vendors, sites, settings, flip mode             | yes   | no              | no       |
 *   | Create/download POs                                  | yes   | yes             | no       |
 *   | Lock / unlock a site                                 | yes   | no              | no       |
 * "External" today is just FRANCHISEE (plan.md section 2); every other Role
 * value is an "other internal role". Every function here is a pure role
 * check — mode gating and the Site lock gate live in site-boq-write-guard.ts
 * and are composed on top of these in each Server Action.
 */

/**
 * Creating/listing user accounts is scoped to ADMIN only.
 */
export function canManageUsers(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Site BOQ is internal-only (plan.md section 2): every /site-boq/* page must
 * 403 a FRANCHISEE user. All other internal roles can view every screen
 * (plan.md section 5, "View all Site BOQ screens: yes").
 */
export function canViewSiteBoq(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/**
 * SiteItem.qty / remarkSize and the order-tracking fields (poAmount, boqLink,
 * poLink, approvedVia, link, advanceGiven, stage, followUp, remarks) — row 2
 * of the table above. Same role set as canViewSiteBoq (every non-FRANCHISEE
 * role, Admin included); kept as its own named function since it guards a
 * narrower, write-specific permission that happens to share the same roles.
 */
export function canEditSiteItemTracking(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
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
 * Create/download Purchase Orders — row 5, same role set as canViewSiteBoq
 * (every non-FRANCHISEE role). Kept as its own function per this file's
 * convention of one function per plan.md section 5 row, even though the
 * underlying check is identical to canViewSiteBoq.
 */
export function canCreatePo(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/**
 * Site Tracker (site-tracker-plan.md section 4, rule 6): "Admin + internal
 * roles. External roles: no sidebar item, 403 on pages and APIs." Same role
 * set as canViewSiteBoq/canEditSiteItemTracking — FRANCHISEE is the one
 * external role today — kept as its own function since it's a separate
 * module with its own plan document, not literally Site BOQ's rule.
 */
export function canViewSiteTracker(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/** Status/assignee/remark/evidence-add edits — same role set as canViewSiteTracker (site-tracker-plan.md section 4, rule 6). */
export function canEditSiteTracker(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
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
 * Operations BOQ (operations-boq-handoff.md section 7): internal-only. Every
 * internal role can view every site; FRANCHISEE has no access at all (no
 * sidebar item, 403 on the page, refused in every action).
 */
export function canViewOpsBoq(user: Pick<CurrentUser, "role">): boolean {
  return user.role !== "FRANCHISEE";
}

/**
 * Edit any Operations BOQ cell, add a row, rename/delete an added row — Admin
 * and the existing OPERATIONS role only (the doc's "new Operations role" already
 * exists in the Role enum). Other internal roles are read-only.
 */
export function canEditOpsBoq(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN" || user.role === "OPERATIONS";
}
