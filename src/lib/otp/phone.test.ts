import { describe, expect, it } from "vitest";
import { normalizePhoneToE164, maskPhoneE164 } from "./phone";

describe("normalizePhoneToE164", () => {
  it("normalizes a bare 10-digit Indian mobile number", () => {
    expect(normalizePhoneToE164("9876543210")).toBe("+919876543210");
  });

  it("normalizes a number already carrying the 91 country code", () => {
    expect(normalizePhoneToE164("919876543210")).toBe("+919876543210");
  });

  it("normalizes a number already in E.164 form", () => {
    expect(normalizePhoneToE164("+919876543210")).toBe("+919876543210");
  });

  it("normalizes a number with a leading trunk 0", () => {
    expect(normalizePhoneToE164("09876543210")).toBe("+919876543210");
  });

  it("strips spaces/dashes before validating", () => {
    expect(normalizePhoneToE164("98765-43210")).toBe("+919876543210");
    expect(normalizePhoneToE164("+91 98765 43210")).toBe("+919876543210");
  });

  it("rejects a number that isn't a plausible Indian mobile (wrong length)", () => {
    expect(normalizePhoneToE164("12345")).toBeNull();
  });

  it("rejects a number starting outside the 6-9 Indian mobile range", () => {
    expect(normalizePhoneToE164("1234567890")).toBeNull();
  });
});

describe("maskPhoneE164", () => {
  it("shows the first 2 and last 3 digits, masking the middle 5", () => {
    expect(maskPhoneE164("+919876543210")).toBe("+91 98•••••210");
  });

  it("falls back to a fully-masked string for an unexpected shape", () => {
    expect(maskPhoneE164("not-a-phone")).toBe("••••••••••");
  });
});
