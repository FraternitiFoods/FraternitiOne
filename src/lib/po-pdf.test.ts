import { describe, it, expect } from "vitest";
import { generatePurchaseOrderPdf, collectMissingPoFields, type PoPdfData } from "./po-pdf";

const BLANK_COMPANY = { name: "", address: "", gstin: "", phone: "", email: "", signatoryName: "" };
const BLANK_VENDOR = { name: "", address: null, gstin: null, phone: null, email: null };

const BASE_DATA: PoPdfData = {
  poNumber: "FF-PO-2026-0001",
  poDate: new Date("2026-11-01"),
  deliveryBy: new Date("2026-11-08"),
  deliveryDays: 7,
  paymentTerms: "50% advance, balance within 7 days after delivery",
  gstPercent: 18,
  subtotal: 6202.5,
  gstAmount: 1116.45,
  total: 7318.95,
  company: BLANK_COMPANY,
  vendor: BLANK_VENDOR,
  site: { name: "Ayodhya", shortCode: "AYD", note: null },
  categoryName: "Kitchen Smallware",
  terms: ["Delivery within N days.", "Goods must match sample.", "Send GST invoice.", "PO may be cancelled if delayed."],
  lines: [
    { nameSnapshot: "GN Pan 1x2x6", remarkSize: null, qty: 10, rate: 500, amount: 5000, photoStorageKey: null },
    { nameSnapshot: "Tongs", remarkSize: "12 inch", qty: 5, rate: 240.5, amount: 1202.5, photoStorageKey: null },
  ],
};

describe("collectMissingPoFields (this session: 'mark the missing fields clearly instead of failing')", () => {
  it("lists every blank company and vendor field", () => {
    const missing = collectMissingPoFields({ company: BLANK_COMPANY, vendor: BLANK_VENDOR });
    expect(missing).toContain("Company name");
    expect(missing).toContain("Company GSTIN");
    expect(missing).toContain("Signatory name");
    expect(missing).toContain("Vendor address");
    expect(missing).toContain("Vendor GSTIN");
    expect(missing).toHaveLength(10);
  });

  it("is empty once every field is filled in", () => {
    const missing = collectMissingPoFields({
      company: { name: "Fraterniti", address: "Mumbai", gstin: "27AAAAA0000A1Z5", phone: "9999999999", email: "a@b.com", signatoryName: "Owner" },
      vendor: { name: "Gogia", address: "Delhi", gstin: "07AAAAA0000A1Z5", phone: "8888888888", email: "v@b.com" },
    });
    expect(missing).toEqual([]);
  });

  it("uses the vendor's name (not the generic word) in its field labels when the name is set", () => {
    const missing = collectMissingPoFields({ company: BLANK_COMPANY, vendor: { ...BLANK_VENDOR, name: "Gogia" } });
    expect(missing).toContain("Gogia GSTIN");
  });
});

describe("generatePurchaseOrderPdf", () => {
  it("still generates a valid PDF when every company/vendor field is blank, instead of failing", async () => {
    const bytes = await generatePurchaseOrderPdf(BASE_DATA);
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("still generates a valid PDF with every field filled in", async () => {
    const bytes = await generatePurchaseOrderPdf({
      ...BASE_DATA,
      company: { name: "Fraterniti", address: "Mumbai", gstin: "27AAAAA0000A1Z5", phone: "9999999999", email: "a@b.com", signatoryName: "Owner" },
      vendor: { name: "Gogia", address: "Delhi", gstin: "07AAAAA0000A1Z5", phone: "8888888888", email: "v@b.com" },
    });
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("handles a PO with no lines (e.g. all qty filtered out) without crashing", async () => {
    const bytes = await generatePurchaseOrderPdf({ ...BASE_DATA, lines: [] });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("paginates a PO with many lines without crashing", async () => {
    const manyLines = Array.from({ length: 80 }, (_, i) => ({
      nameSnapshot: `Item ${i}`,
      remarkSize: `Remark for item number ${i} with some extra wrapping text to force multiple lines`,
      qty: i + 1,
      rate: 100,
      amount: (i + 1) * 100,
      photoStorageKey: null,
    }));
    const bytes = await generatePurchaseOrderPdf({ ...BASE_DATA, lines: manyLines });
    expect(bytes.length).toBeGreaterThan(0);
  });
});
