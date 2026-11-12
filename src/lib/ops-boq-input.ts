import { isHttpUrl, collapseSpaces } from "@/lib/dashboard-site-input";

/**
 * Operations BOQ input rules for ONE cell edit (no DB, no "server-only": the
 * server action validates with these and the client uses the same field list).
 * Everything the client sends is untrusted — the action calls
 * parseOpsBoqCell() and stores only its `value`.
 */

export const OPS_BOQ_NAME_MAX = 200;
export const OPS_BOQ_TEXT_MAX = 500;
export const OPS_BOQ_REMARKS_MAX = 2000;
export const OPS_BOQ_URL_MAX = 2000;
/** decimal(14,2): 12 integer digits. */
export const OPS_BOQ_MONEY_MAX = 9_999_999_999_999.99;

export const OPS_BOQ_BOQ_STATUSES = ["NOT_SHARED", "SHARED"] as const;
export type OpsBoqStatusValue = (typeof OPS_BOQ_BOQ_STATUSES)[number];

/** Editable cells (name has its own rename action; sno is display-only). */
export const OPS_BOQ_EDITABLE_FIELDS = [
  "vendor",
  "boqStatus",
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
] as const;
export type OpsBoqEditableField = (typeof OPS_BOQ_EDITABLE_FIELDS)[number];

export function isOpsBoqEditableField(field: string): field is OpsBoqEditableField {
  return (OPS_BOQ_EDITABLE_FIELDS as readonly string[]).includes(field);
}

/** string for text/url/status/date fields, number for money, null = cleared. */
export type OpsBoqCellValue = string | number | null;

export type ParsedCell = { ok: true; value: OpsBoqCellValue } | { ok: false; error: string };

const TEXT_FIELDS: Partial<Record<OpsBoqEditableField, { label: string; max: number }>> = {
  vendor: { label: "Vendor", max: OPS_BOQ_TEXT_MAX },
  approvedVia: { label: "Approved Via", max: OPS_BOQ_TEXT_MAX },
  stage: { label: "Stage", max: OPS_BOQ_TEXT_MAX },
  remarks: { label: "Remarks", max: OPS_BOQ_REMARKS_MAX },
};

const URL_FIELDS: Partial<Record<OpsBoqEditableField, string>> = {
  linkBoq: "Link of BOQ",
  linkApprovedBoq: "Link of Approved BOQ",
  linkPo: "Link of PO",
  link: "Link",
};

/** "yyyy-mm-dd" that is a real calendar date (rejects 2026-02-31). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates + normalises the raw value for one editable field. Blank = clear
 * (null) for every field except BOQ Status, which can't be empty.
 */
export function parseOpsBoqCell(field: OpsBoqEditableField, raw: unknown): ParsedCell {
  if (raw !== null && raw !== undefined && typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, error: "Invalid value." };
  }

  if (field === "boqStatus") {
    return (OPS_BOQ_BOQ_STATUSES as readonly unknown[]).includes(raw)
      ? { ok: true, value: raw as OpsBoqStatusValue }
      : { ok: false, error: "BOQ Status must be NOT SHARED or SHARED." };
  }

  if (field === "amount" || field === "advanceGiven") {
    const label = field === "amount" ? "Amount" : "Advance Given";
    if (raw === null || raw === undefined) return { ok: true, value: null };
    const text = typeof raw === "number" ? String(raw) : raw.trim().replace(/[₹,\s]/g, "");
    if (text === "") return { ok: true, value: null };
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return { ok: false, error: `${label} must be a number, 0 or more, with at most 2 decimals.` };
    }
    const n = Number(text);
    if (!Number.isFinite(n) || n > OPS_BOQ_MONEY_MAX) return { ok: false, error: `${label} is too large.` };
    return { ok: true, value: n };
  }

  if (typeof raw === "number") return { ok: false, error: "Invalid value." };
  const text = (raw ?? "").trim();

  if (field === "followUpDate") {
    if (text === "") return { ok: true, value: null };
    return isIsoDate(text) ? { ok: true, value: text } : { ok: false, error: "Follow Up must be a valid date." };
  }

  const urlLabel = URL_FIELDS[field];
  if (urlLabel) {
    if (text === "") return { ok: true, value: null };
    if (text.length > OPS_BOQ_URL_MAX) return { ok: false, error: `${urlLabel} is too long.` };
    return isHttpUrl(text) ? { ok: true, value: text } : { ok: false, error: `${urlLabel} must start with http:// or https://.` };
  }

  const textRule = TEXT_FIELDS[field];
  if (!textRule) return { ok: false, error: "Unknown field." };
  if (text === "") return { ok: true, value: null };
  if (text.length > textRule.max) return { ok: false, error: `${textRule.label} is too long (max ${textRule.max} characters).` };
  return { ok: true, value: text };
}

/** Name of an added row: trimmed, whitespace-collapsed, 1..OPS_BOQ_NAME_MAX. */
export function parseOpsBoqName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Name is required." };
  const name = collapseSpaces(raw);
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > OPS_BOQ_NAME_MAX) return { ok: false, error: `Name is too long (max ${OPS_BOQ_NAME_MAX} characters).` };
  return { ok: true, value: name };
}
