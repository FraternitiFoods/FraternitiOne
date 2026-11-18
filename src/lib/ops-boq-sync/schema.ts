import { z } from "zod";

/**
 * Request bodies for the Operations BOQ sheet sync (Suraj's "OPERATIONAL BOQ
 * STATUS LIST": one tab per site, one row per material category). Cells come
 * from Apps Script exactly as the sheet holds them (numbers as strings and vice
 * versa), so every field is "anything scalar or null" here and is validated and
 * normalised per field in commit.ts with the same rules a website edit uses
 * (src/lib/ops-boq-input.ts parseOpsBoqCell).
 */
const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

export const opsRowSchema = z.object({
  sno: cell,
  name: z.string().trim(),
  vendor: cell,
  boqStatus: cell,
  amount: cell,
  linkBoq: cell,
  linkApprovedBoq: cell,
  linkPo: cell,
  approvedVia: cell,
  link: cell,
  advanceGiven: cell,
  stage: cell,
  /** "yyyy-MM-dd" (the script formats it in Asia/Kolkata) or null. */
  followUpDate: cell,
  remarks: cell,
});
export type OpsRowInput = z.infer<typeof opsRowSchema>;

export const opsTabSchema = z.object({
  /** The sheet tab's name; it is matched to a site by name (then SiteAlias). */
  tabName: z.string().trim().min(1),
  /** SHA-256 of this tab's extracted rows (script-side); unchanged tabs are skipped. */
  hash: z.string().trim().min(1),
  rows: z.array(opsRowSchema),
});
export type OpsTabInput = z.infer<typeof opsTabSchema>;

export const commitBodySchema = z.object({
  batchId: z.string().trim().min(1).optional(),
  sheetName: z.string().trim().min(1).optional(),
  tabs: z.array(opsTabSchema),
});
export type CommitBody = z.infer<typeof commitBodySchema>;

export const failBodySchema = z.object({
  batchId: z.string().trim().min(1),
  message: z.string().trim().min(1),
});
export type FailBody = z.infer<typeof failBodySchema>;
