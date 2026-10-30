import { z } from "zod";

/**
 * Request bodies for plan.md section 7's push endpoints. Numeric-ish fields
 * (qty, rates, money) accept number|string|null since Apps Script's export
 * of a spreadsheet cell can stringify numbers — normalization to a real
 * number (or null for "missing") happens in boq-import.ts, not here.
 */
const numericish = z.union([z.number(), z.string(), z.null()]).optional();

export const beginBodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

export const siteInputSchema = z.object({
  siteKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  shortCode: z.string().optional().nullable(),
  openingDate: z.string().optional().nullable(),
});
export type SiteInput = z.infer<typeof siteInputSchema>;

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1),
  categories: z.array(z.string()).optional().default([]),
});
export type VendorInput = z.infer<typeof vendorInputSchema>;

export const siteItemInputSchema = z.object({
  siteKey: z.string().trim().min(1),
  qty: numericish,
  remarkSize: z.string().optional().nullable(),
  poAmount: numericish,
  boqLink: z.string().optional().nullable(),
  poLink: z.string().optional().nullable(),
  approvedVia: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
  advanceGiven: numericish,
  stage: z.string().optional().nullable(),
  followUp: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});
export type SiteItemInput = z.infer<typeof siteItemInputSchema>;

export const itemInputSchema = z.object({
  itemKey: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1),
  note: z.string().optional().nullable(),
  finalVendor: z.string().trim().optional().nullable(),
  rates: z.record(z.string(), numericish).optional().default({}),
  sites: z.array(siteItemInputSchema).optional().default([]),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

export const categoryChunkInputSchema = z.object({
  category: z.string().trim().min(1),
  group: z.enum(["operating", "interior"]),
  vendors: z.array(z.string()).optional().default([]),
  items: z.array(itemInputSchema).min(1),
});
export type CategoryChunkInput = z.infer<typeof categoryChunkInputSchema>;

export const chunkBodySchema = z.discriminatedUnion("type", [
  z.object({ runId: z.string().trim().min(1), type: z.literal("sites"), data: z.array(siteInputSchema) }),
  z.object({ runId: z.string().trim().min(1), type: z.literal("vendors"), data: z.array(vendorInputSchema) }),
  z.object({ runId: z.string().trim().min(1), type: z.literal("category"), data: categoryChunkInputSchema }),
]);
export type ChunkBody = z.infer<typeof chunkBodySchema>;

export const photoBodySchema = z.object({
  runId: z.string().trim().min(1),
  itemKey: z.string().trim().min(1),
  index: z.number().int().min(0).max(2),
  mimeType: z.string().trim().min(1),
  dataBase64: z.string().min(1),
});
export type PhotoBody = z.infer<typeof photoBodySchema>;

export const finishBodySchema = z.object({
  runId: z.string().trim().min(1),
});
