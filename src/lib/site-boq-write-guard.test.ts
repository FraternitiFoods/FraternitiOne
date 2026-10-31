import { describe, expect, it } from "vitest";
import { isWriteAllowedInMode, isSiteItemEditableForLock, type BoqWriteArea } from "./site-boq-write-guard";

const GATED_AREAS: BoqWriteArea[] = ["siteItem", "item", "site"];
const EXEMPT_AREAS: BoqWriteArea[] = ["vendor", "settings"];

/** plan.md section 1: "in SHEET_LIVE every BOQ write is rejected except vendor contact details, PO creation, settings." */
describe("isWriteAllowedInMode", () => {
  it("blocks every gated area in SHEET_LIVE", () => {
    for (const area of GATED_AREAS) expect(isWriteAllowedInMode("SHEET_LIVE", area)).toBe(false);
  });

  it("allows every gated area in WEBSITE_LIVE", () => {
    for (const area of GATED_AREAS) expect(isWriteAllowedInMode("WEBSITE_LIVE", area)).toBe(true);
  });

  it("allows the exempt areas (vendor contact details, settings) in either mode", () => {
    for (const area of EXEMPT_AREAS) {
      expect(isWriteAllowedInMode("SHEET_LIVE", area)).toBe(true);
      expect(isWriteAllowedInMode("WEBSITE_LIVE", area)).toBe(true);
    }
  });
});

/** plan.md sections 3 and 5: a locked site blocks SiteItem edits for every role, Admin included. */
describe("isSiteItemEditableForLock", () => {
  it("allows edits when the site is not locked", () => {
    expect(isSiteItemEditableForLock({ isLocked: false, name: "Ayodhya" })).toEqual({ ok: true });
  });

  it("blocks edits when the site is locked, naming the site in the error", () => {
    const result = isSiteItemEditableForLock({ isLocked: true, name: "Ayodhya" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Ayodhya");
  });
});
