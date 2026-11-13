import type { OnboardingStatus, Role } from "@prisma/client";

/**
 * Role -> module access, in one place (plan.md section 12). Pure and
 * client-safe on purpose (no `server-only`, no DB): `permissions.ts` builds its
 * per-action checks on these sets and the sidebar uses `canSeeModule`, so the
 * menu and the server can't drift apart.
 *
 * Dashboard task assignments are NOT here — they are per-user data, not a
 * property of the role (see dashboard-access.ts).
 */

export type AppModule = "dashboard" | "site-tracker" | "site-boq" | "operations-boq" | "store-onboarding";

/** The one external role. Dashboard shows them only their own assigned site; no other module. */
export const EXTERNAL_ROLES: readonly Role[] = ["FRANCHISEE"];

/** Site BOQ + Operations BOQ pages: procurement, site execution and money roles. */
export const BOQ_VIEW_ROLES: readonly Role[] = [
  "ADMIN",
  "OPERATIONS",
  "PROJECT_MANAGER",
  "INTERIORS",
  "ACCOUNTS",
  "MANAGEMENT",
];

/** Edit qty / remark-size / order-tracking fields in Site BOQ. Accounts and Management are view-only here. */
export const BOQ_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"];

/** Create / download purchase orders: the BOQ editors plus Accounts. */
export const PO_ROLES: readonly Role[] = [...BOQ_EDIT_ROLES, "ACCOUNTS"];

/** Operations BOQ cell/row edits (unchanged from before this section). */
export const OPS_BOQ_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS"];

/** Site Tracker status/assignee/remark/evidence-add. Everyone else internal is view-only. */
export const TRACKER_EDIT_ROLES: readonly Role[] = ["ADMIN", "OPERATIONS", "PROJECT_MANAGER", "INTERIORS"];

/**
 * Store Onboarding staff pages (/store-onboarding, /signing): every role that
 * has an action in the flow. Sales creates and sees only its own rows; Legal
 * reviews KYC and prepares the LOI; Accounts verifies payment; Management
 * countersigns. Everyone else is hidden + 403. The franchisee uses their own
 * portal (/onboarding), not these pages.
 */
export const ONBOARDING_VIEW_ROLES: readonly Role[] = ["ADMIN", "SALES", "LEGAL", "ACCOUNTS", "MANAGEMENT"];

/** Create a store onboarding (Sales owns the relationship). */
export const ONBOARDING_CREATE_ROLES: readonly Role[] = ["ADMIN", "SALES"];

/** Accept / request changes on a franchisee's KYC. */
export const KYC_REVIEW_ROLES: readonly Role[] = ["ADMIN", "LEGAL"];

/** Verify the franchisee's payment proof. */
export const PAYMENT_REVIEW_ROLES: readonly Role[] = ["ADMIN", "ACCOUNTS"];

/** Generate / edit / release the LOI. */
export const LOI_PREPARE_ROLES: readonly Role[] = ["ADMIN", "LEGAL"];

/** Company countersignature on the LOI. */
export const COMPANY_SIGN_ROLES: readonly Role[] = ["ADMIN", "MANAGEMENT"];

export function isExternalRole(role: Role): boolean {
  return EXTERNAL_ROLES.includes(role);
}

export function canSeeModule(role: Role, module: AppModule): boolean {
  switch (module) {
    case "dashboard":
      return true;
    case "site-tracker":
      return !isExternalRole(role);
    case "site-boq":
    case "operations-boq":
      return BOQ_VIEW_ROLES.includes(role);
    case "store-onboarding":
      return ONBOARDING_VIEW_ROLES.includes(role);
  }
}

/**
 * A franchisee whose store onboarding is not finished (no LOI Complete yet)
 * works in the /onboarding portal instead of the staff app. A franchisee with
 * no onboarding record (e.g. assigned straight to a Dashboard site) is not
 * affected.
 */
export function needsOnboardingPortal(role: Role, onboardingStatus: OnboardingStatus | null | undefined): boolean {
  return isExternalRole(role) && !!onboardingStatus && onboardingStatus !== "LOI_COMPLETE";
}

/**
 * Where a user lands after login / password set / visiting `/`. Roles that
 * can't see Site BOQ would 403 there. A franchisee mid-onboarding lands on the
 * onboarding portal.
 */
export function landingPathForRole(role: Role, onboardingStatus?: OnboardingStatus | null): string {
  if (needsOnboardingPortal(role, onboardingStatus)) return "/onboarding";
  return canSeeModule(role, "site-boq") ? "/site-boq" : "/dashboard";
}
