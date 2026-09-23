/**
 * Splits the category rollup (category-progress.ts) into two screens:
 * "BOQ" (line items sourced straight from the founder's BOQ Excel) and
 * "Construction & Ops Progress" (process checklists that were never in that
 * Excel -- Interior/OPERATION/MARKETING/HR, plus CULINARY's pre-opening
 * process steps, which sit alongside CULINARY's BOQ-sourced kitchen/bar
 * equipment in the same category).
 *
 * No DB column for this -- every Task already carries `category` + `title`,
 * so the split is derived from those, not stored. Kept as a lookup here
 * rather than a `route` field on OPS_PROGRESS_TASK_TEMPLATES so the ~800-line
 * template stays untouched.
 */
export type OpsRoute = "BOQ" | "OPS";

const OPS_ONLY_CATEGORIES = new Set(["Interior", "OPERATION", "MARKETING", "HR"]);

/** CULINARY's pre-opening process steps (not BOQ line items) -- everything
 * else in CULINARY (equipment, utensils, crockery, barware) is BOQ. */
const CULINARY_OPS_TITLES = new Set([
  "Kitchen Layout & Design",
  "Menu Devlopment",
  "Equipment & Supplies",
  "Staff interviews & Trials",
  "Training & Orientation",
  "Soft Opening Preperations",
  "Final Prepration (Kitchen setup)",
  "Foods Trials",
  "Quality Control & Assurence",
  "Staff Training & Devlopment",
  "Training Calander",
  "Recipies S.O.Ps",
  "Vendor Management (Kitchen & Food)",
  "Marketing Promotion Offers",
  "Training Recorde Maintainence",
]);

export function getTaskRoute(category: string | null, title: string): OpsRoute {
  if (!category) return "BOQ";
  if (OPS_ONLY_CATEGORIES.has(category)) return "OPS";
  if (category === "CULINARY" && CULINARY_OPS_TITLES.has(title)) return "OPS";
  return "BOQ";
}
