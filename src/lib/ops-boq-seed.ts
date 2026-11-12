/**
 * Operations BOQ — the 11 fixed material rows every site gets
 * (operations-boq-handoff.md section 4). This is the ONE place to change the
 * names or default vendors. A default vendor is only a prefill: each site's
 * row can overwrite it. `fixedKey` is the row's stable identity (never shown,
 * never changed once shipped) — ensureOpsBoqRows is idempotent on it, so
 * renaming a `name` here does not duplicate rows for sites that already have it
 * (it just won't rename those sites' existing rows).
 *
 * `sno` is a display string, not a counter: UTENSILS KITCHEN and UTENSILS FOH
 * share S.No 1 (a merged cell in the sheet), so the fixed rows are never
 * auto-renumbered.
 */
export type OpsBoqSeedRow = {
  fixedKey: string;
  sno: string;
  name: string;
  /** null = blank default vendor. */
  vendor: string | null;
};

export const OPS_BOQ_FIXED_ROWS: readonly OpsBoqSeedRow[] = [
  { fixedKey: "UTENSILS_KITCHEN", sno: "1", name: "UTENSILS KITCHEN", vendor: null },
  { fixedKey: "UTENSILS_FOH", sno: "1", name: "UTENSILS FOH", vendor: "VK/GOGIA" },
  { fixedKey: "CROCKERY", sno: "2", name: "CROCKERY", vendor: "OSAMA" },
  { fixedKey: "GLASSWARE", sno: "3", name: "GLASSWARE", vendor: "BENTEX" },
  { fixedKey: "POS", sno: "4", name: "POS", vendor: "TOUCH INFOMATICS" },
  { fixedKey: "EQUIPMENTS", sno: "5", name: "EQUIPMENTS", vendor: "AAHAR KITCHEN" },
  { fixedKey: "UNIFORM", sno: "6", name: "UNIFORM", vendor: "MANOJ CHIRVI, MAHALAXMI" },
  { fixedKey: "CUTLERY", sno: "7", name: "CUTLERY", vendor: "AWK" },
  {
    fixedKey: "METAL_BASKET_BRASS_BOWL",
    sno: "8",
    name: `METAL BASKET, BRASS BOWL 6' (H), ALUM. JALI POT BIG, DOME 10"`,
    vendor: "ANWAR",
  },
  {
    fixedKey: "BLACK_BOX_PACKAGING",
    sno: "9",
    name: "BLACK BOX & PACKAGING & CERTIFICATE",
    vendor: "PRAMOD PRINTING",
  },
  { fixedKey: "PROBES", sno: "10", name: "PROBES", vendor: "SALIM" },
];
