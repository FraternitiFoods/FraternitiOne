import { db } from "@/lib/db";

/**
 * Known app_settings keys (plan.md section 3). Stored as a generic key/value
 * table so new settings can be added without a migration — this module is
 * the single place that knows the key names, value shapes and defaults;
 * nothing else should read/write AppSetting rows directly.
 */
export const APP_SETTING_KEYS = [
  "mode",
  "companyName",
  "companyAddress",
  "companyGstin",
  "companyPhone",
  "companyEmail",
  "signatoryName",
  "defaultGstPercent",
  "defaultPaymentTerms",
  "defaultDeliveryDays",
  "poTerms",
  "urgentDays",
  "soonDays",
  "poNumberPrefix",
] as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

export type ImportMode = "SHEET_LIVE" | "WEBSITE_LIVE";

export type AppSettingsValues = {
  mode: ImportMode;
  companyName: string;
  companyAddress: string;
  companyGstin: string;
  companyPhone: string;
  companyEmail: string;
  signatoryName: string;
  defaultGstPercent: number;
  defaultPaymentTerms: string;
  defaultDeliveryDays: number;
  /** PO terms (plan.md section 6.6), shown as numbered lines on the PDF. */
  poTerms: string[];
  urgentDays: number;
  soonDays: number;
  /** PO numbering (plan.md section 4.5): "configurable prefix + running number," default format `<prefix>-<YYYY>-<NNNN>`. The real prefix/format still needs founder confirmation (section 9). */
  poNumberPrefix: string;
};

/**
 * Defaults per plan.md section 3/6.6. Company/vendor identity fields (name,
 * address, GSTIN, signatory) are left blank on purpose — plan.md section 9
 * flags these as open questions for the founder, not something to guess.
 */
export const DEFAULT_APP_SETTINGS: AppSettingsValues = {
  mode: "SHEET_LIVE",
  companyName: "",
  companyAddress: "",
  companyGstin: "",
  companyPhone: "",
  companyEmail: "",
  signatoryName: "",
  defaultGstPercent: 18,
  defaultPaymentTerms: "50% advance, balance within 7 days after delivery",
  defaultDeliveryDays: 7,
  poTerms: [
    "Delivery within N days of the PO date.",
    "Goods must match the approved sample/photo; damaged or different goods are returned.",
    "Send goods with a GST invoice; the PO number must be written on the invoice.",
    "The company may cancel the PO if delivery is delayed.",
  ],
  urgentDays: 7,
  soonDays: 30,
  poNumberPrefix: "FF-PO",
};

function isAppSettingKey(key: string): key is AppSettingKey {
  return (APP_SETTING_KEYS as readonly string[]).includes(key);
}

/** Reads all settings, falling back to defaults for any key not yet seeded. */
export async function getAppSettings(): Promise<AppSettingsValues> {
  const rows = await db.appSetting.findMany();
  const overrides = Object.fromEntries(
    rows.filter((row) => isAppSettingKey(row.key)).map((row) => [row.key, row.value])
  ) as Partial<AppSettingsValues>;
  return { ...DEFAULT_APP_SETTINGS, ...overrides };
}

/**
 * Just the one field the import endpoints gate on (plan.md section 7: reject
 * with 403 when mode = WEBSITE_LIVE) — avoids reading/validating every
 * setting on every import request.
 */
export async function getImportMode(): Promise<ImportMode> {
  const row = await db.appSetting.findUnique({ where: { key: "mode" } });
  return row?.value === "WEBSITE_LIVE" ? "WEBSITE_LIVE" : "SHEET_LIVE";
}
