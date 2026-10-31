import "server-only";

import { getAppSettings, type ImportMode } from "@/lib/app-settings";

/**
 * plan.md section 1: "in SHEET_LIVE every BOQ write is rejected" except
 * vendor contact details, PO creation (not yet built — milestone M6) and
 * settings. This is the single place that exemption list lives, so it can't
 * drift between Server Actions. `isWriteAllowedInMode` is pure (no DB) so the
 * rule itself is unit-testable; `checkModeAllowsWrite` is the thin DB-backed
 * wrapper every Server Action actually calls.
 */
export type BoqWriteArea = "siteItem" | "item" | "vendor" | "site" | "settings" | "purchaseOrder";

// "purchaseOrder" is exempt per plan.md section 4.5: "Allowed in both modes
// (POs are website-native data, not imported). Creating a PO never changes
// BOQ quantities."
const MODE_EXEMPT_AREAS: ReadonlySet<BoqWriteArea> = new Set(["vendor", "settings", "purchaseOrder"]);

export function isWriteAllowedInMode(mode: ImportMode, area: BoqWriteArea): boolean {
  return MODE_EXEMPT_AREAS.has(area) || mode === "WEBSITE_LIVE";
}

export type WriteGuardResult = { ok: true } | { ok: false; error: string };

const SHEET_LIVE_MESSAGE = "Sheet is live — editing is disabled until an Admin switches the mode in Settings.";

export async function checkModeAllowsWrite(area: BoqWriteArea): Promise<WriteGuardResult> {
  const { mode } = await getAppSettings();
  if (isWriteAllowedInMode(mode, area)) return { ok: true };
  return { ok: false, error: SHEET_LIVE_MESSAGE };
}

/**
 * Site lock (plan.md sections 3 and 5): while a site is locked, nobody — not
 * even Admin — can edit its qty, remarkSize, rateOverride or order-tracking
 * fields; an Admin must unlock it first. Pure — takes the already-fetched
 * Site row, no DB access of its own, so it's unit-testable directly.
 */
export function isSiteItemEditableForLock(site: { isLocked: boolean; name: string }): WriteGuardResult {
  if (site.isLocked) {
    return { ok: false, error: `"${site.name}" is locked. An Admin must unlock it before this can be edited.` };
  }
  return { ok: true };
}
