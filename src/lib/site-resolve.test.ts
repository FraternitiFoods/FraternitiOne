import { describe, expect, it } from "vitest";
import { cleanSiteName, isWebsiteSourceKey, planSiteResolution, type SiteForResolve } from "./site-resolve";

const site = (id: string, name: string, sourceKey: string, usedInTracker = false): SiteForResolve => ({
  id,
  name,
  sourceKey,
  isActive: true,
  usedInTracker,
});

const sheetSite = site("s1", "Tulsi Hissar", "SHEET-1");
const webSite = site("w1", "Tulsi Pune", "WEB-1");

describe("planSiteResolution", () => {
  it("matches by normalised name (case, spacing) and keeps the stored display name", () => {
    const plan = planSiteResolution(["  tulsi   HISSAR "], [sheetSite], [], false);
    expect(plan.matched.get("tulsi hissar")).toEqual({ id: "s1", name: "Tulsi Hissar", websiteOwned: false, created: false });
    expect(plan.toCreate.size).toBe(0);
  });

  it("falls back to an alias for a spelling difference", () => {
    const plan = planSiteResolution(["Tulsi Hisar"], [sheetSite], [{ aliasNorm: "tulsi hisar", siteId: "s1" }], false);
    expect(plan.matched.get("tulsi hisar")?.id).toBe("s1");
    expect(plan.toCreate.size).toBe(0);
  });

  it("queues an unknown name for creation, once, with the first-seen display name", () => {
    const plan = planSiteResolution(["Tulsi  Indore", "tulsi indore", "TULSI INDORE"], [sheetSite], [], false);
    expect([...plan.toCreate.entries()]).toEqual([["tulsi indore", "Tulsi Indore"]]);
  });

  it("returns a website-created (WEB-) site flagged websiteOwned so callers skip it", () => {
    const plan = planSiteResolution(["Tulsi Pune"], [webSite], [], true);
    expect(plan.matched.get("tulsi pune")?.websiteOwned).toBe(true);
    // never flips usedInTracker on a website-owned site
    expect(plan.needTracker).toEqual([]);
  });

  it("asks to mark a matched sheet-origin site as a tracker site only when needed", () => {
    expect(planSiteResolution(["Tulsi Hissar"], [sheetSite], [], true).needTracker).toEqual(["s1"]);
    expect(planSiteResolution(["Tulsi Hissar"], [site("s1", "Tulsi Hissar", "SHEET-1", true)], [], true).needTracker).toEqual([]);
    expect(planSiteResolution(["Tulsi Hissar"], [sheetSite], [], false).needTracker).toEqual([]);
  });

  it("ignores blank names and an alias pointing at a missing site", () => {
    const plan = planSiteResolution(["   ", ""], [sheetSite], [{ aliasNorm: "ghost", siteId: "nope" }], false);
    expect(plan.matched.size + plan.toCreate.size).toBe(0);
    const ghost = planSiteResolution(["Ghost"], [sheetSite], [{ aliasNorm: "ghost", siteId: "nope" }], false);
    expect([...ghost.toCreate.values()]).toEqual(["Ghost"]);
  });
});

describe("helpers", () => {
  it("cleanSiteName trims and collapses whitespace but keeps case", () => {
    expect(cleanSiteName("  Tulsi   Pune ")).toBe("Tulsi Pune");
  });
  it("isWebsiteSourceKey only matches the WEB- prefix", () => {
    expect(isWebsiteSourceKey("WEB-abc")).toBe(true);
    expect(isWebsiteSourceKey("SHEET-abc")).toBe(false);
    expect(isWebsiteSourceKey("TRACKER-abc")).toBe(false);
  });
});
