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

/**
 * SiteItem.rateOverride — the per-site rate override plan.md section 3 called
 * out as "the UI/data model must support a site-specific override later."
 * Admin only, same actor as canEditItems but kept as its own function since
 * it's a SiteItem field (per site+item), not an Item field.
 */
export function canEditRateOverride(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}
