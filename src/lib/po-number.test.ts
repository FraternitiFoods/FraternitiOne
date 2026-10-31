import { describe, it, expect } from "vitest";
import { formatPoNumber, parseRunningNumber } from "./po-number";

describe("formatPoNumber (plan.md section 4.5 default format <prefix>-<YYYY>-<NNNN>)", () => {
  it("pads the running number to 4 digits", () => {
    expect(formatPoNumber("FF-PO", 2026, 1)).toBe("FF-PO-2026-0001");
    expect(formatPoNumber("FF-PO", 2026, 42)).toBe("FF-PO-2026-0042");
  });

  it("does not truncate a running number wider than 4 digits", () => {
    expect(formatPoNumber("FF-PO", 2026, 12345)).toBe("FF-PO-2026-12345");
  });
});

describe("parseRunningNumber", () => {
  it("round-trips with formatPoNumber for the same prefix/year", () => {
    const poNumber = formatPoNumber("FF-PO", 2026, 7);
    expect(parseRunningNumber(poNumber, "FF-PO", 2026)).toBe(7);
  });

  it("returns null for a different prefix", () => {
    const poNumber = formatPoNumber("FF-PO", 2026, 7);
    expect(parseRunningNumber(poNumber, "OTHER-PO", 2026)).toBeNull();
  });

  it("returns null for a different year", () => {
    const poNumber = formatPoNumber("FF-PO", 2026, 7);
    expect(parseRunningNumber(poNumber, "FF-PO", 2027)).toBeNull();
  });

  it("returns null for a non-numeric suffix (a manually edited PO number)", () => {
    expect(parseRunningNumber("FF-PO-2026-ABCD", "FF-PO", 2026)).toBeNull();
  });
});
