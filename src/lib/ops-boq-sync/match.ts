/**
 * Pure matching of one sheet tab's rows to a site's existing Operations BOQ
 * rows (owner decision 3): a sheet row is matched to the site's fixed row by
 * category NAME; a row that matches none becomes an "added row" of that site;
 * a previously sheet-added row that left the sheet is reported stale (the
 * caller deletes only those — website-added rows are never touched).
 *
 * No DB, no "server-only": unit-tested directly. Tab layouts differ per site in
 * the real sheet (e.g. a lone "UTENSILS" row instead of KITCHEN + FOH), so
 * matching is tolerant but conservative: when in doubt the row becomes an added
 * row, which loses nothing.
 */

export type ExistingOpsRow = {
  id: string;
  name: string;
  fixedKey: string | null;
  /** Created by an earlier sync (as an added row). */
  fromSheet: boolean;
};

export type MatchResult = {
  /** sheet row index -> existing row id to update. */
  matches: { sheetIndex: number; rowId: string }[];
  /** sheet row indexes that matched nothing: create as added rows of the site. */
  added: number[];
  /** previously sheet-added rows no longer in the sheet: delete. */
  staleRowIds: string[];
};

/** Upper-case, & -> AND, punctuation -> space, collapsed. Same idea as bqNorm_ in BoqImport.js. */
export function normalizeRowName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Blank rows and the TOTAL row are not material categories. */
export function isSkippableRowName(name: string): boolean {
  const n = normalizeRowName(name);
  return n === "" || n === "TOTAL" || n === "GRAND TOTAL";
}

/** Tolerant per-fixed-row patterns, tried only after an exact name match fails. Keys are OPS_BOQ_FIXED_ROWS[].fixedKey. */
const FIXED_ROW_PATTERNS: { fixedKey: string; test: RegExp }[] = [
  { fixedKey: "UTENSILS_KITCHEN", test: /UTENSIL.*KITCHEN|KITCHEN.*UTENSIL/ },
  { fixedKey: "UTENSILS_FOH", test: /UTENSIL.*(FOH|FRONT)|(FOH|FRONT).*UTENSIL/ },
  { fixedKey: "CROCKERY", test: /CROCKER/ },
  { fixedKey: "GLASSWARE", test: /GLASS/ },
  { fixedKey: "POS", test: /^POS( |$)/ },
  { fixedKey: "EQUIPMENTS", test: /EQUIPMENT/ },
  { fixedKey: "UNIFORM", test: /UNIFORM/ },
  { fixedKey: "CUTLERY", test: /CUTLER/ },
  { fixedKey: "METAL_BASKET_BRASS_BOWL", test: /METAL BASKET|BRASS BOWL|JALI POT/ },
  { fixedKey: "BLACK_BOX_PACKAGING", test: /BLACK BOX|PACKAGING/ },
  { fixedKey: "PROBES", test: /PROBE/ },
];

/** A lone "UTENSILS" row (some tabs don't split KITCHEN/FOH) takes whichever of the two is still free. */
const LONE_UTENSILS = /^UTENSILS?$/;
const UTENSIL_KEYS = ["UTENSILS_KITCHEN", "UTENSILS_FOH"];

export function matchTabRows(sheetNames: readonly string[], existing: readonly ExistingOpsRow[]): MatchResult {
  const free = new Map(existing.map((r) => [r.id, r]));
  const matches: MatchResult["matches"] = [];
  const added: number[] = [];

  const take = (predicate: (r: ExistingOpsRow) => boolean): ExistingOpsRow | undefined => {
    for (const row of free.values()) {
      if (predicate(row)) {
        free.delete(row.id);
        return row;
      }
    }
    return undefined;
  };

  sheetNames.forEach((rawName, sheetIndex) => {
    const norm = normalizeRowName(rawName);

    // 1. exact (normalised) name — fixed rows and previously sheet-added rows alike.
    let hit = take((r) => normalizeRowName(r.name) === norm);

    // 2. tolerant fixed-row patterns.
    if (!hit) {
      const keys = FIXED_ROW_PATTERNS.filter((p) => p.test.test(norm)).map((p) => p.fixedKey);
      if (keys.length > 0) hit = take((r) => r.fixedKey !== null && keys.includes(r.fixedKey));
    }

    // 3. a lone UTENSILS row.
    if (!hit && LONE_UTENSILS.test(norm)) {
      hit = take((r) => r.fixedKey !== null && UTENSIL_KEYS.includes(r.fixedKey));
    }

    if (hit) matches.push({ sheetIndex, rowId: hit.id });
    else added.push(sheetIndex);
  });

  const staleRowIds = [...free.values()].filter((r) => r.fromSheet && r.fixedKey === null).map((r) => r.id);
  return { matches, added, staleRowIds };
}
