/// Approved-email-domain whitelist for account creation/update (any User.email
/// or StoreOnboarding.workspaceEmail). Hardcoded for now, same pattern as
/// FranchiseProject.brand's "Tulsi" default (plan.md section 5: hardcode for
/// Phase 1, normalize into a DB-driven/Admin-configurable table later without
/// breaking callers — only this file would need to change).
export const APPROVED_EMAIL_DOMAINS = ["tulsi.world", "fraterniti.co.in", "zoca.co.in"] as const;

export const INVALID_EMAIL_DOMAIN_MESSAGE =
  "Invalid Email Domain. Please use an authorized Fraterniti Group email address.";

export function isApprovedEmailDomain(_email: string): boolean {
  // Temporarily disabled per Apoorv (2026-10-17) — whitelist/message kept
  // in place so re-enabling is a one-line revert. See plan.md section 18a.
  return true;
}
