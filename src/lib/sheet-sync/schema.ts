import { z } from "zod";

/**
 * Request bodies for docs/sheet-sync/CLAUDE_CODE_HANDOFF.md section 3's
 * contract. Shape verified directly against docs/sheet-sync/sample-payload.json
 * (the real script's output). Numeric-ish fields accept number|string|null —
 * same reason as src/lib/import/schema.ts: Apps Script's export of a
 * spreadsheet cell can stringify numbers.
 */
const numericish = z.union([z.number(), z.string(), z.null()]).optional();

/** Same idea as numericish, for fields that are usually text but the sheet export can hand over as a number (e.g. a "remark" cell that's just a bare number) — normalized to string|null up front so downstream code only ever sees text. */
const textish = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const triggerSchema = z.enum(["button", "daily", "menu"]);
export type SyncTrigger = z.infer<typeof triggerSchema>;

export const siteStartInputSchema = z.object({
  position: z.number().int().optional(),
  name: z.string().trim().min(1),
  shortCode: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  openingDate: z.string().trim().optional().nullable(),
});
export type SiteStartInput = z.infer<typeof siteStartInputSchema>;

export const startBodySchema = z.object({
  requestId: z.string().trim().min(1).nullable(),
  trigger: triggerSchema,
  sheetName: z.string().trim().min(1),
  sheetId: z.string().trim().min(1),
  sites: z.array(siteStartInputSchema),
  // Handoff section 4: "lockedSites = sites whose order is delivered/locked
  // in the sheet" — sent as a list of site names, since this contract
  // (unlike the old /api/import/boq/* one) matches sites by name, not by a
  // stable per-site key.
  lockedSites: z.array(z.string().trim()).default([]),
  tabCount: z.number().int().min(0),
});
export type StartBody = z.infer<typeof startBodySchema>;

/** One entry of an item's `sites` map (handoff section 4's example). */
export const siteEntrySchema = z.object({
  qty: numericish,
  remark: textish,
  remarks: textish,
  stage: textish,
  trackedAmount: numericish,
  boqLink: textish,
  poLink: textish,
  approvedVia: textish,
  link: textish,
  advGiven: numericish,
  followUp: textish,
});
export type SiteEntry = z.infer<typeof siteEntrySchema>;

export const chunkItemSchema = z.object({
  itemKey: z.string().trim().min(1),
  row: z.number().int().optional().nullable(),
  sNo: z.number().int().optional().nullable(),
  name: z.string().trim().min(1),
  finalRate: numericish,
  rateMissing: z.boolean().optional().default(false),
  finalVendor: z.string().trim().optional().nullable(),
  vendorRates: z.record(z.string(), numericish).optional().default({}),
  notes: textish,
  sites: z.record(z.string(), siteEntrySchema).optional().default({}),
});
export type ChunkItem = z.infer<typeof chunkItemSchema>;

export const chunkTabSchema = z.object({
  category: z.string().trim().min(1),
  tab: z.string().trim().optional(),
  vendors: z.array(z.string().trim()).optional().default([]),
  items: z.array(chunkItemSchema),
});
export type ChunkTab = z.infer<typeof chunkTabSchema>;

export const chunkBodySchema = z.object({
  runId: z.string().trim().min(1),
  tab: chunkTabSchema,
});
export type ChunkBody = z.infer<typeof chunkBodySchema>;

export const finishBodySchema = z.object({
  runId: z.string().trim().min(1),
  expected: z.object({
    tabs: z.number().int().min(0),
    items: z.number().int().min(0),
    sites: z.number().int().min(0),
  }),
});
export type FinishBody = z.infer<typeof finishBodySchema>;

export const failBodySchema = z.object({
  runId: z.string().trim().min(1),
  message: z.string().trim().min(1),
});
export type FailBody = z.infer<typeof failBodySchema>;
