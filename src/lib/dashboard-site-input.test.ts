import { describe, expect, it } from "vitest";
import {
  collapseSpaces,
  createDashboardSiteSchema,
  deleteSiteConfirmPhrase,
  isDeleteSiteConfirmed,
  isHttpUrl,
  linkifyText,
  normalizeSiteName,
  updateDashboardStepSchema,
} from "./dashboard-site-input";

describe("site name rules", () => {
  it("collapses whitespace and normalises case the same way the sync does", () => {
    expect(collapseSpaces("  Tulsi   Pune ")).toBe("Tulsi Pune");
    expect(normalizeSiteName("  Tulsi   PUNE ")).toBe("tulsi pune");
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isHttpUrl("https://drive.google.com/drive/folders/abc")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,hi")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("createDashboardSiteSchema", () => {
  it("accepts a name alone; optional fields become null", () => {
    const r = createDashboardSiteSchema.safeParse({ name: "  Tulsi  Pune ", driveFolderUrl: "", deptLinksText: "  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ name: "Tulsi Pune", driveFolderUrl: null, deptLinksText: null });
  });

  it("treats a missing form field (FormData.get -> null) as empty", () => {
    const r = createDashboardSiteSchema.safeParse({ name: "A", driveFolderUrl: null, deptLinksText: null });
    expect(r.success).toBe(true);
  });

  it("rejects blank / too-long / control-char names", () => {
    expect(createDashboardSiteSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createDashboardSiteSchema.safeParse({ name: null }).success).toBe(false);
    expect(createDashboardSiteSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(createDashboardSiteSchema.safeParse({ name: "bad\u0000name" }).success).toBe(false);
  });

  it("rejects a non-http(s) Drive link", () => {
    const r = createDashboardSiteSchema.safeParse({ name: "A", driveFolderUrl: "javascript:alert(1)" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/http/);
  });

  it("rejects over-long dept links text", () => {
    expect(createDashboardSiteSchema.safeParse({ name: "A", deptLinksText: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("updateDashboardStepSchema", () => {
  it("validates status and trims remark to null when blank", () => {
    const ok = updateDashboardStepSchema.safeParse({ status: "COMPLETED", remark: "  " });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.remark).toBeNull();
    expect(updateDashboardStepSchema.safeParse({ status: "DONE", remark: "" }).success).toBe(false);
    expect(updateDashboardStepSchema.safeParse({ status: "NOT_STARTED", remark: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("linkifyText", () => {
  it("returns plain text as a single segment", () => {
    expect(linkifyText("interiors only")).toEqual([{ text: "interiors only" }]);
  });

  it("links http(s) URLs and keeps the surrounding text", () => {
    expect(linkifyText("interiors --> https://x.com/a, done")).toEqual([
      { text: "interiors --> " },
      { text: "https://x.com/a", href: "https://x.com/a" },
      { text: ", done" },
    ]);
  });

  it("handles several lines/links and never links non-http schemes", () => {
    const segs = linkifyText("a: http://a.com\nb: javascript:alert(1)\nc: https://c.com");
    expect(segs.filter((s) => s.href).map((s) => s.href)).toEqual(["http://a.com", "https://c.com"]);
    expect(segs.map((s) => s.text).join("")).toBe("a: http://a.com\nb: javascript:alert(1)\nc: https://c.com");
  });

  it("returns an empty list for empty text", () => {
    expect(linkifyText("")).toEqual([]);
  });
});

describe("delete-site confirmation phrase", () => {
  it("is 'Delete site <name>' and must be typed exactly (case-sensitive, edges trimmed)", () => {
    expect(deleteSiteConfirmPhrase("Tulsi Pune")).toBe("Delete site Tulsi Pune");
    expect(isDeleteSiteConfirmed("Tulsi Pune", "Delete site Tulsi Pune")).toBe(true);
    expect(isDeleteSiteConfirmed("Tulsi Pune", "  Delete site Tulsi Pune ")).toBe(true);
    expect(isDeleteSiteConfirmed("Tulsi Pune", "delete site tulsi pune")).toBe(false);
    expect(isDeleteSiteConfirmed("Tulsi Pune", "Tulsi Pune")).toBe(false);
    expect(isDeleteSiteConfirmed("Tulsi Pune", "Delete site Tulsi")).toBe(false);
    expect(isDeleteSiteConfirmed("Tulsi Pune", "")).toBe(false);
    expect(isDeleteSiteConfirmed("Tulsi Pune", null)).toBe(false);
    expect(isDeleteSiteConfirmed("Tulsi Pune", undefined)).toBe(false);
  });
});
