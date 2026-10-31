import { describe, it, expect } from "vitest";
import { buildPoLineCandidates, poTotals, resolveSelectedVendorIds, buildPoPreviews } from "./po-calc";
import type { ComputedItem, ComputedSiteEntry } from "./boq-data";

const EMPTY_SITE_ENTRY_FIELDS: Omit<ComputedSiteEntry, "siteId" | "qty" | "rate" | "amount" | "hasRate"> = {
  rateOverride: null,
  ordered: false,
  stage: null,
  remarkSize: null,
  poAmount: null,
  advanceGiven: null,
  pending: null,
  boqLink: null,
  poLink: null,
  approvedVia: null,
  link: null,
  followUp: null,
  remarks: null,
};

function makeItem(params: {
  id: string;
  categoryId: string;
  finalVendorId: string | null;
  siteId: string;
  qty: number;
  rate: number | null;
}): ComputedItem {
  const amount = params.rate ? params.qty * params.rate : 0;
  return {
    id: params.id,
    sourceKey: params.id,
    name: `Item ${params.id}`,
    sizeNote: null,
    note: null,
    categoryId: params.categoryId,
    finalVendorId: params.finalVendorId,
    finalVendorName: params.finalVendorId,
    finalRate: params.rate,
    vendorRates: [],
    siteEntries: [
      {
        ...EMPTY_SITE_ENTRY_FIELDS,
        siteId: params.siteId,
        qty: params.qty,
        rate: params.rate,
        amount,
        hasRate: params.rate !== null,
      },
    ],
  };
}

const CATEGORY = "cat-1";
const SITE = "site-1";
const VENDOR = "vendor-1";
const OTHER_VENDOR = "vendor-2";
const OTHER_SITE = "site-2";

describe("buildPoLineCandidates (plan.md section 4.5: qty > 0, matching final vendor)", () => {
  const items: ComputedItem[] = [
    makeItem({ id: "A", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 10, rate: 500 }),
    makeItem({ id: "B", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 5, rate: 240.5 }),
    makeItem({ id: "C-no-rate", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 3, rate: null }),
    makeItem({ id: "D-other-vendor", categoryId: CATEGORY, finalVendorId: OTHER_VENDOR, siteId: SITE, qty: 100, rate: 10 }),
    makeItem({ id: "E-zero-qty", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 0, rate: 50 }),
    makeItem({ id: "F-other-site", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: OTHER_SITE, qty: 1, rate: 50 }),
  ];

  it("includes only qty > 0 lines for the chosen site and final vendor", () => {
    const lines = buildPoLineCandidates({ items, siteId: SITE, vendorId: VENDOR });
    expect(lines.map((l) => l.itemId).sort()).toEqual(["A", "B", "C-no-rate"]);
  });

  it("includes a qty > 0 line even with a missing rate, amount 0 (plan.md section 6.5 — still shown, just flagged)", () => {
    const lines = buildPoLineCandidates({ items, siteId: SITE, vendorId: VENDOR });
    const noRateLine = lines.find((l) => l.itemId === "C-no-rate")!;
    expect(noRateLine.hasRate).toBe(false);
    expect(noRateLine.amount).toBe(0);
  });
});

describe("poTotals — one site + category + vendor sums correctly with 18% GST", () => {
  it("computes subtotal, GST and grand total from the line amounts", () => {
    const items: ComputedItem[] = [
      makeItem({ id: "A", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 10, rate: 500 }), // 5000
      makeItem({ id: "B", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 5, rate: 240.5 }), // 1202.50
      makeItem({ id: "C-no-rate", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 3, rate: null }), // 0
    ];
    const lines = buildPoLineCandidates({ items, siteId: SITE, vendorId: VENDOR });
    const totals = poTotals(lines, 18);

    expect(totals.subtotal).toBe(6202.5);
    expect(totals.gstAmount).toBe(1116.45);
    expect(totals.total).toBe(7318.95);
  });
});

describe("resolveSelectedVendorIds", () => {
  const categoryVendorIds = ["v1", "v2", "v3"];

  it("treats an empty selection as all vendors", () => {
    expect(resolveSelectedVendorIds([], categoryVendorIds)).toEqual(categoryVendorIds);
  });

  it("treats an explicit 'all' as all vendors, ignoring other selections", () => {
    expect(resolveSelectedVendorIds(["all", "v1"], categoryVendorIds)).toEqual(categoryVendorIds);
  });

  it("keeps only the explicitly selected ids that are actually linked to the category", () => {
    expect(resolveSelectedVendorIds(["v1", "not-a-category-vendor"], categoryVendorIds)).toEqual(["v1"]);
  });
});

describe("buildPoPreviews", () => {
  it("produces one preview per vendor with qty > 0 lines, skipping vendors with none", () => {
    const items: ComputedItem[] = [
      makeItem({ id: "A", categoryId: CATEGORY, finalVendorId: VENDOR, siteId: SITE, qty: 10, rate: 500 }),
      makeItem({ id: "D-other-vendor", categoryId: CATEGORY, finalVendorId: OTHER_VENDOR, siteId: SITE, qty: 0, rate: 10 }),
    ];
    const previews = buildPoPreviews({
      items,
      siteId: SITE,
      vendors: [
        { id: VENDOR, name: "Vendor One" },
        { id: OTHER_VENDOR, name: "Vendor Two" },
      ],
      gstPercent: 18,
    });

    expect(previews).toHaveLength(1);
    expect(previews[0].vendorId).toBe(VENDOR);
    expect(previews[0].totals.total).toBe(5900); // 5000 + 18% GST
  });
});
