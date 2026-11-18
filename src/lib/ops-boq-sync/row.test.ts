import { describe, expect, it } from "vitest";
import { normalizeOpsRow, toBoqStatus } from "./row";
import { opsRowSchema } from "./schema";

const row = (over: Record<string, unknown> = {}) => opsRowSchema.parse({ name: "CROCKERY", ...over });

describe("toBoqStatus", () => {
  it("SHARED only for a shared value or a ticked box", () => {
    expect(toBoqStatus("SHARED")).toBe("SHARED");
    expect(toBoqStatus(" shared ")).toBe("SHARED");
    expect(toBoqStatus(true)).toBe("SHARED");
  });
  it("NOT SHARED, blank and anything else is NOT_SHARED", () => {
    expect(toBoqStatus("NOT SHARED")).toBe("NOT_SHARED");
    expect(toBoqStatus("")).toBe("NOT_SHARED");
    expect(toBoqStatus(null)).toBe("NOT_SHARED");
    expect(toBoqStatus("pending")).toBe("NOT_SHARED");
    expect(toBoqStatus(3)).toBe("NOT_SHARED");
  });
});

describe("normalizeOpsRow", () => {
  it("normalises money (₹, commas, strings), trims text and keeps valid links/dates", () => {
    const warnings: string[] = [];
    const v = normalizeOpsRow(
      row({
        vendor: "  OSAMA ",
        boqStatus: "SHARED",
        amount: "₹3,37,866",
        advanceGiven: 100000,
        linkBoq: " https://docs.google.com/x ",
        followUpDate: "2026-11-20",
        remarks: " ok ",
      }),
      "Tab T",
      (m) => warnings.push(m)
    );
    expect(v).toMatchObject({
      vendor: "OSAMA",
      boqStatus: "SHARED",
      amount: 337866,
      advanceGiven: 100000,
      linkBoq: "https://docs.google.com/x",
      followUpDate: "2026-11-20",
      remarks: "ok",
    });
    expect(warnings).toEqual([]);
  });

  it("blank cells become null with no warning", () => {
    const warnings: string[] = [];
    const v = normalizeOpsRow(row({ vendor: "", amount: "", link: null }), "Tab T", (m) => warnings.push(m));
    expect(v).toMatchObject({ vendor: null, amount: null, link: null, boqStatus: "NOT_SHARED" });
    expect(warnings).toEqual([]);
  });

  it("drops a bad cell (and warns) instead of failing the row: junk amount, non-http link, bad date", () => {
    const warnings: string[] = [];
    const v = normalizeOpsRow(
      row({ amount: "TBD", linkPo: "javascript:alert(1)", followUpDate: "20/11/2026", vendor: "OSAMA" }),
      'Tab "T", row "CROCKERY"',
      (m) => warnings.push(m)
    );
    expect(v).toMatchObject({ amount: null, linkPo: null, followUpDate: null, vendor: "OSAMA" });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('Tab "T", row "CROCKERY"');
  });

  it("a negative amount is rejected like on the website", () => {
    const warnings: string[] = [];
    expect(normalizeOpsRow(row({ amount: -5 }), "T", (m) => warnings.push(m)).amount).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("a boolean in a text cell is treated as empty, not stored", () => {
    const warnings: string[] = [];
    const v = normalizeOpsRow(row({ stage: true }), "T", (m) => warnings.push(m));
    expect(v.stage).toBeNull();
    expect(warnings).toEqual([]);
  });
});
