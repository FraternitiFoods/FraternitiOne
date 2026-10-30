/**
 * The 21 categories (plan.md section 8) — a closed, admin-controlled list
 * that "rarely changes" (plan.md section 1), seeded once in M1. Shared
 * between prisma/seed.ts and the import API (milestone M2), which upserts a
 * category's group/displayName from the sheet push but never creates a
 * category outside this list.
 *
 * Group for "Equipments, Gas, Ducting, Tiles, AC" is not stated in plan.md
 * section 8 — assigned INTERIOR here (civil/MEP fit-out work, same bucket as
 * Furniture/Lighting/Wallpaper) as a provisional best guess. Every real
 * category chunk (plan.md section 7) carries its own `group` value and will
 * overwrite this on first import, so the guess is self-correcting; flagged
 * in the M1/M2 report rather than silently assumed.
 */
export type SeedCategory = {
  name: string;
  displayName: string;
  group: "OPERATING" | "INTERIOR";
  sortOrder: number;
};

export const SEED_CATEGORIES: SeedCategory[] = [
  // Operating
  { name: "Uniforms", displayName: "Uniforms", group: "OPERATING", sortOrder: 1 },
  { name: "Probes", displayName: "Probes & Table Decor", group: "OPERATING", sortOrder: 2 },
  { name: "POS & Printers", displayName: "POS & Printers", group: "OPERATING", sortOrder: 3 },
  { name: "Kitchen Smallware", displayName: "Kitchen Smallware", group: "OPERATING", sortOrder: 4 },
  { name: "Glassware", displayName: "Glassware", group: "OPERATING", sortOrder: 5 },
  { name: "DEWNOW", displayName: "Glassware & Bar Accessories", group: "OPERATING", sortOrder: 6 },
  { name: "FOH & Bar", displayName: "FOH & Bar Equipment", group: "OPERATING", sortOrder: 7 },
  { name: "Cutleries", displayName: "Cutleries", group: "OPERATING", sortOrder: 8 },
  { name: "Ceramic Studio", displayName: "Ceramic Studio", group: "OPERATING", sortOrder: 9 },
  { name: "Decor", displayName: "Decor", group: "OPERATING", sortOrder: 10 },
  { name: "FFPL x Global", displayName: "Printed Collaterals", group: "OPERATING", sortOrder: 11 },
  // Interior
  { name: "Planters", displayName: "Artificial Plants & Tree", group: "INTERIOR", sortOrder: 12 },
  { name: "Lighting", displayName: "Lighting", group: "INTERIOR", sortOrder: 13 },
  { name: "Furniture", displayName: "Furniture", group: "INTERIOR", sortOrder: 14 },
  { name: "Wallpaper & Decor", displayName: "Wallpaper & Decor", group: "INTERIOR", sortOrder: 15 },
  { name: "Photo Frames", displayName: "Photo Frames", group: "INTERIOR", sortOrder: 16 },
  // Added later
  { name: "Equipments", displayName: "Equipments", group: "INTERIOR", sortOrder: 17 },
  { name: "Gas", displayName: "Gas", group: "INTERIOR", sortOrder: 18 },
  { name: "Ducting", displayName: "Ducting", group: "INTERIOR", sortOrder: 19 },
  { name: "Tiles", displayName: "Tiles", group: "INTERIOR", sortOrder: 20 },
  { name: "AC", displayName: "AC", group: "INTERIOR", sortOrder: 21 },
];
