import { parseOpsBoqCell, type OpsBoqEditableField } from "@/lib/ops-boq-input";
import type { OpsRowInput } from "./schema";

/**
 * Pure: one sheet row's cells -> the values stored on OpsBoqRow. Reuses the
 * exact validation a website edit goes through (parseOpsBoqCell), so a sheet
 * can never put something in a cell that the website itself would refuse. A bad
 * cell is dropped (null) with a warning instead of failing the whole sync.
 */

export type OpsRowValues = {
  vendor: string | null;
  boqStatus: "SHARED" | "NOT_SHARED";
  amount: number | null;
  linkBoq: string | null;
  linkApprovedBoq: string | null;
  linkPo: string | null;
  approvedVia: string | null;
  link: string | null;
  advanceGiven: number | null;
  stage: string | null;
  followUpDate: string | null;
  remarks: string | null;
};

type Scalar = string | number | boolean | null;

/**
 * "SHARED" -> SHARED. "NOT SHARED", blank or anything else -> NOT_SHARED (the
 * sheet's status column is titled BOQ STATUS / DELIVARY DATES / BOQ SHARED
 * depending on the tab and holds SHARED or nothing). A checkbox (true) counts as shared.
 */
export function toBoqStatus(raw: Scalar): "SHARED" | "NOT_SHARED" {
  if (raw === true) return "SHARED";
  if (typeof raw !== "string") return "NOT_SHARED";
  const text = raw.trim().toUpperCase();
  if (/\bNOT\b/.test(text)) return "NOT_SHARED";
  return text.includes("SHARED") ? "SHARED" : "NOT_SHARED";
}

const TEXT_AND_NUMBER_FIELDS: readonly Exclude<OpsBoqEditableField, "boqStatus">[] = [
  "vendor",
  "amount",
  "linkBoq",
  "linkApprovedBoq",
  "linkPo",
  "approvedVia",
  "link",
  "advanceGiven",
  "stage",
  "followUpDate",
  "remarks",
];

/** `label` names the row in warnings, e.g. `Tab "TULSI RAIPUR", row "CROCKERY"`. */
export function normalizeOpsRow(row: OpsRowInput, label: string, warn: (message: string) => void): OpsRowValues {
  const out: Record<string, string | number | null> = {};
  for (const field of TEXT_AND_NUMBER_FIELDS) {
    const raw = row[field];
    // A boolean/other junk in a text cell is not a value (parseOpsBoqCell would reject it as "Invalid value.").
    const parsed = parseOpsBoqCell(field, typeof raw === "boolean" ? null : raw);
    if (parsed.ok) {
      out[field] = parsed.value;
    } else {
      out[field] = null;
      warn(`${label}: ${field} ignored — ${parsed.error}`);
    }
  }
  return { ...(out as Omit<OpsRowValues, "boqStatus">), boqStatus: toBoqStatus(row.boqStatus) };
}
