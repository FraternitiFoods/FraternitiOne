import { describe, expect, it } from "vitest";
import {
  advanceExceedsAmount,
  isFollowUpOverdue,
  nextSno,
  pendingAmount,
  round2,
  sharedCount,
  todayIsoIST,
  totalsOf,
} from "./ops-boq-calc";
import { OPS_BOQ_FIXED_ROWS } from "./ops-boq-seed";
import { isIsoDate, isOpsBoqEditableField, parseOpsBoqCell, parseOpsBoqName } from "./ops-boq-input";

describe("ops-boq-seed — operations-boq-handoff.md section 4", () => {
  it("has exactly the 11 fixed rows, in order, with the documented S.No and default vendors", () => {
    expect(OPS_BOQ_FIXED_ROWS.map((r) => [r.sno, r.name, r.vendor])).toEqual([
      ["1", "UTENSILS KITCHEN", null],
      ["1", "UTENSILS FOH", "VK/GOGIA"],
      ["2", "CROCKERY", "OSAMA"],
      ["3", "GLASSWARE", "BENTEX"],
      ["4", "POS", "TOUCH INFOMATICS"],
      ["5", "EQUIPMENTS", "AAHAR KITCHEN"],
      ["6", "UNIFORM", "MANOJ CHIRVI, MAHALAXMI"],
      ["7", "CUTLERY", "AWK"],
      ["8", `METAL BASKET, BRASS BOWL 6' (H), ALUM. JALI POT BIG, DOME 10"`, "ANWAR"],
      ["9", "BLACK BOX & PACKAGING & CERTIFICATE", "PRAMOD PRINTING"],
      ["10", "PROBES", "SALIM"],
    ]);
  });

  it("has unique fixedKeys (the idempotency key ensureOpsBoqRows relies on)", () => {
    const keys = OPS_BOQ_FIXED_ROWS.map((r) => r.fixedKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ops-boq-calc", () => {
  it("Pending = Amount - Advance, '-' (null) when Amount is empty, empty Advance counts as 0", () => {
    expect(pendingAmount(100000, 25000)).toBe(75000);
    expect(pendingAmount(100000, null)).toBe(100000);
    expect(pendingAmount(null, 5000)).toBeNull();
    expect(pendingAmount(null, null)).toBeNull();
    expect(pendingAmount(0.3, 0.1)).toBe(0.2); // no float drift
  });

  it("flags Advance greater than Amount (Pending goes negative) without hiding it", () => {
    expect(advanceExceedsAmount(1000, 1500)).toBe(true);
    expect(pendingAmount(1000, 1500)).toBe(-500);
    expect(advanceExceedsAmount(1000, 1000)).toBe(false);
    expect(advanceExceedsAmount(null, 500)).toBe(false);
    expect(advanceExceedsAmount(1000, null)).toBe(false);
  });

  it("totals: sum of Amount, Advance and per-row Pending (rows with no Amount have no Pending)", () => {
    const totals = totalsOf([
      { amount: 337866, advanceGiven: 100000 },
      { amount: 50000, advanceGiven: null },
      { amount: null, advanceGiven: 2000 },
      { amount: null, advanceGiven: null },
    ]);
    expect(totals).toEqual({ amount: 387866, advanceGiven: 102000, pending: 287866 });
    expect(totalsOf([])).toEqual({ amount: 0, advanceGiven: 0, pending: 0 });
  });

  it("counts shared BOQs", () => {
    expect(sharedCount([{ boqStatus: "SHARED" }, { boqStatus: "NOT_SHARED" }, { boqStatus: "SHARED" }])).toEqual({ shared: 2, total: 3 });
  });

  it("follow-up is overdue only when the date is in the past AND money is pending", () => {
    expect(isFollowUpOverdue("2026-11-01", 500, "2026-11-12")).toBe(true);
    expect(isFollowUpOverdue("2026-11-12", 500, "2026-11-12")).toBe(false); // today is not past
    expect(isFollowUpOverdue("2026-11-20", 500, "2026-11-12")).toBe(false);
    expect(isFollowUpOverdue("2026-11-01", 0, "2026-11-12")).toBe(false);
    expect(isFollowUpOverdue("2026-11-01", null, "2026-11-12")).toBe(false);
    expect(isFollowUpOverdue(null, 500, "2026-11-12")).toBe(false);
  });

  it("todayIsoIST uses the India calendar date", () => {
    expect(todayIsoIST(new Date("2026-11-11T19:00:00Z"))).toBe("2026-11-12"); // 00:30 IST next day
    expect(todayIsoIST(new Date("2026-11-12T10:00:00Z"))).toBe("2026-11-12");
  });

  it("next S.No for an added row is max numeric + 1", () => {
    expect(nextSno(OPS_BOQ_FIXED_ROWS.map((r) => r.sno))).toBe("11");
    expect(nextSno(["1", "1", "2", "11", "12"])).toBe("13");
    expect(nextSno([])).toBe("1");
    expect(nextSno(["x", ""])).toBe("1");
  });

  it("round2", () => {
    expect(round2(1.005 * 100)).toBe(100.5);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("ops-boq-input", () => {
  it("only the documented cells are editable (name/sno/ids are not)", () => {
    for (const f of ["vendor", "boqStatus", "amount", "linkBoq", "linkApprovedBoq", "linkPo", "approvedVia", "link", "advanceGiven", "stage", "followUpDate", "remarks"]) {
      expect(isOpsBoqEditableField(f)).toBe(true);
    }
    for (const f of ["name", "sno", "isFixed", "fixedKey", "siteId", "id", "updatedById", "__proto__"]) {
      expect(isOpsBoqEditableField(f)).toBe(false);
    }
  });

  it("BOQ Status accepts only NOT_SHARED / SHARED", () => {
    expect(parseOpsBoqCell("boqStatus", "SHARED")).toEqual({ ok: true, value: "SHARED" });
    expect(parseOpsBoqCell("boqStatus", "NOT_SHARED")).toEqual({ ok: true, value: "NOT_SHARED" });
    expect(parseOpsBoqCell("boqStatus", "APPROVED").ok).toBe(false);
    expect(parseOpsBoqCell("boqStatus", "").ok).toBe(false);
    expect(parseOpsBoqCell("boqStatus", null).ok).toBe(false);
  });

  it("money: >= 0, max 2 decimals, strips ₹ and commas, empty clears", () => {
    expect(parseOpsBoqCell("amount", "₹3,37,866")).toEqual({ ok: true, value: 337866 });
    expect(parseOpsBoqCell("amount", "1250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(parseOpsBoqCell("amount", 0)).toEqual({ ok: true, value: 0 });
    expect(parseOpsBoqCell("advanceGiven", "")).toEqual({ ok: true, value: null });
    expect(parseOpsBoqCell("advanceGiven", null)).toEqual({ ok: true, value: null });
    expect(parseOpsBoqCell("amount", "-5").ok).toBe(false);
    expect(parseOpsBoqCell("amount", "1.234").ok).toBe(false);
    expect(parseOpsBoqCell("amount", "abc").ok).toBe(false);
    expect(parseOpsBoqCell("amount", "1e5").ok).toBe(false);
    expect(parseOpsBoqCell("amount", "99999999999999").ok).toBe(false); // exceeds decimal(14,2)
  });

  it("links: only http(s):// or empty", () => {
    for (const f of ["linkBoq", "linkApprovedBoq", "linkPo", "link"] as const) {
      expect(parseOpsBoqCell(f, "https://drive.google.com/x")).toEqual({ ok: true, value: "https://drive.google.com/x" });
      expect(parseOpsBoqCell(f, "http://example.com")).toEqual({ ok: true, value: "http://example.com" });
      expect(parseOpsBoqCell(f, "  ")).toEqual({ ok: true, value: null });
      expect(parseOpsBoqCell(f, "javascript:alert(1)").ok).toBe(false);
      expect(parseOpsBoqCell(f, "data:text/html,hi").ok).toBe(false);
      expect(parseOpsBoqCell(f, "drive.google.com/x").ok).toBe(false);
    }
  });

  it("follow-up date: real calendar dates only", () => {
    expect(parseOpsBoqCell("followUpDate", "2026-11-30")).toEqual({ ok: true, value: "2026-11-30" });
    expect(parseOpsBoqCell("followUpDate", "")).toEqual({ ok: true, value: null });
    expect(parseOpsBoqCell("followUpDate", "2026-02-31").ok).toBe(false);
    expect(parseOpsBoqCell("followUpDate", "30/11/2026").ok).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("free text is trimmed, blank clears, over-long is rejected, non-strings are rejected", () => {
    expect(parseOpsBoqCell("approvedVia", "  RT ")).toEqual({ ok: true, value: "RT" });
    expect(parseOpsBoqCell("stage", "")).toEqual({ ok: true, value: null });
    expect(parseOpsBoqCell("remarks", "x".repeat(2001)).ok).toBe(false);
    expect(parseOpsBoqCell("vendor", { a: 1 }).ok).toBe(false);
    expect(parseOpsBoqCell("vendor", 12).ok).toBe(false);
  });

  it("names: required, collapsed, bounded", () => {
    expect(parseOpsBoqName("  RO   & GEYSER ")).toEqual({ ok: true, value: "RO & GEYSER" });
    expect(parseOpsBoqName("   ").ok).toBe(false);
    expect(parseOpsBoqName(undefined).ok).toBe(false);
    expect(parseOpsBoqName("x".repeat(201)).ok).toBe(false);
  });
});
