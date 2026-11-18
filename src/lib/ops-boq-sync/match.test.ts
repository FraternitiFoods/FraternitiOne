import { describe, expect, it } from "vitest";
import { OPS_BOQ_FIXED_ROWS } from "@/lib/ops-boq-seed";
import { isSkippableRowName, matchTabRows, normalizeRowName, type ExistingOpsRow } from "./match";

/** The 11 seeded rows as a site has them right after ensureOpsBoqRows. */
const fixed: ExistingOpsRow[] = OPS_BOQ_FIXED_ROWS.map((r) => ({
  id: `id-${r.fixedKey}`,
  name: r.name,
  fixedKey: r.fixedKey,
  fromSheet: false,
}));

const idOf = (key: string) => `id-${key}`;

describe("normalizeRowName / isSkippableRowName", () => {
  it("upper-cases, turns & into AND and drops punctuation", () => {
    expect(normalizeRowName(`Black Box & Packaging & Certificate`)).toBe("BLACK BOX AND PACKAGING AND CERTIFICATE");
    expect(normalizeRowName(`METAL BASKET, BRASS BOWL 6' (H)`)).toBe("METAL BASKET BRASS BOWL 6 H");
  });
  it("blank and TOTAL rows are skippable, a category is not", () => {
    expect(isSkippableRowName("  ")).toBe(true);
    expect(isSkippableRowName("Total")).toBe(true);
    expect(isSkippableRowName("CROCKERY")).toBe(false);
  });
});

describe("matchTabRows", () => {
  it("matches every fixed row by its exact name and adds nothing", () => {
    const r = matchTabRows(
      OPS_BOQ_FIXED_ROWS.map((x) => x.name),
      fixed
    );
    expect(r.added).toEqual([]);
    expect(r.matches).toHaveLength(11);
    expect(r.matches.find((m) => m.sheetIndex === 2)?.rowId).toBe(idOf("CROCKERY"));
  });

  it("matches tolerant spellings (singular/plural, extra words)", () => {
    const r = matchTabRows(["CROCKERIES", "Glass ware", "CUTLERIES", "EQUIPMENT"], fixed);
    expect(r.matches.map((m) => m.rowId)).toEqual([idOf("CROCKERY"), idOf("GLASSWARE"), idOf("CUTLERY"), idOf("EQUIPMENTS")]);
    expect(r.added).toEqual([]);
  });

  it("a lone UTENSILS row takes KITCHEN first, then a second one takes FOH", () => {
    const first = matchTabRows(["UTENSILS"], fixed);
    expect(first.matches[0].rowId).toBe(idOf("UTENSILS_KITCHEN"));
    const both = matchTabRows(["UTENSILS", "UTENSILS"], fixed);
    expect(both.matches.map((m) => m.rowId)).toEqual([idOf("UTENSILS_KITCHEN"), idOf("UTENSILS_FOH")]);
  });

  it("KITCHEN / FOH utensil rows match their own fixed row", () => {
    const r = matchTabRows(["UTENSILS FOH", "UTENSILS KITCHEN"], fixed);
    expect(r.matches.map((m) => m.rowId)).toEqual([idOf("UTENSILS_FOH"), idOf("UTENSILS_KITCHEN")]);
  });

  it("a category that is not one of the 11 becomes an added row", () => {
    const r = matchTabRows(["CROCKERY", "RO & GEYSER", "FLOWER VASE"], fixed);
    expect(r.matches).toHaveLength(1);
    expect(r.added).toEqual([1, 2]);
  });

  it("a second row for an already-matched fixed row becomes an added row, never a double match", () => {
    const r = matchTabRows(["CROCKERY", "CROCKERY"], fixed);
    expect(r.matches).toHaveLength(1);
    expect(r.added).toEqual([1]);
  });

  it("re-syncing: a previously sheet-added row matches by name and is not duplicated or deleted", () => {
    const existing = [...fixed, { id: "added-1", name: "RO & GEYSER", fixedKey: null, fromSheet: true }];
    const r = matchTabRows(["RO & GEYSER"], existing);
    expect(r.matches).toEqual([{ sheetIndex: 0, rowId: "added-1" }]);
    expect(r.added).toEqual([]);
    expect(r.staleRowIds).toEqual([]);
  });

  it("a sheet-added row that left the sheet is stale; a website-added row (fromSheet=false) never is", () => {
    const existing = [
      ...fixed,
      { id: "gone", name: "OLD ITEM", fixedKey: null, fromSheet: true },
      { id: "web-added", name: "MY OWN ROW", fixedKey: null, fromSheet: false },
    ];
    const r = matchTabRows(["CROCKERY"], existing);
    expect(r.staleRowIds).toEqual(["gone"]);
  });

  it("an empty tab changes nothing about fixed rows and flags only sheet-added rows stale", () => {
    const r = matchTabRows([], [...fixed, { id: "x", name: "X", fixedKey: null, fromSheet: true }]);
    expect(r.matches).toEqual([]);
    expect(r.staleRowIds).toEqual(["x"]);
  });
});
