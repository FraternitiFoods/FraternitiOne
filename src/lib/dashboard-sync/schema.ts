import { z } from "zod";

/**
 * Request bodies for the Dashboard sheet sync (dashboard-sheet-sync-plan.md
 * sections 3-4). Numeric-ish/text-ish helpers mirror src/lib/sheet-sync/schema.ts
 * — Apps Script's export of a spreadsheet cell can hand numbers over as
 * strings and vice versa.
 */
const textish = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : String(v).trim() || null));

export const triggerSchema = z.enum(["button", "daily"]);
export type DashboardSyncTrigger = z.infer<typeof triggerSchema>;

export const deliverableSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().min(1),
});
export type Deliverable = z.infer<typeof deliverableSchema>;

export const statusSchema = z.enum(["Not started", "In progress", "Completed", "Not required"]);

/** One leaf or parent row on a Stage tab, already sliced to one site. */
export const stepInputSchema = z.object({
  stepKey: z.string().trim().min(1),
  parentKey: z.string().trim().optional().nullable(),
  label: z.string().trim().min(1),
  sortOrder: z.number().int(),
  isParent: z.boolean().default(false),
  assignedTo: textish,
  // Parents carry no status of their own (the website derives one from
  // children) — null/omitted for isParent rows, required for leaves.
  status: statusSchema.optional().nullable(),
  remark: textish,
  shared: z.boolean().default(false),
  deliverables: z.array(deliverableSchema).default([]),
});
export type StepInput = z.infer<typeof stepInputSchema>;

export const stageInputSchema = z.object({
  stageNo: z.number().int().min(1).max(13),
  stageName: z.string().trim().min(1),
  steps: z.array(stepInputSchema),
});
export type StageInput = z.infer<typeof stageInputSchema>;

/** dashboard-sheet-sync-plan.md section 3's Dashboard-tab per-site check row. */
export const sheetSummarySchema = z.object({
  total: z.number().optional().nullable(),
  completed: z.number().optional().nullable(),
  inProgress: z.number().optional().nullable(),
  notStarted: z.number().optional().nullable(),
  pct: z.number().optional().nullable(),
  shared: z.number().optional().nullable(),
  notShared: z.number().optional().nullable(),
  notRequired: z.number().optional().nullable(),
  perStagePct: z.array(z.number().nullable()).optional().default([]),
});
export type SheetSummary = z.infer<typeof sheetSummarySchema>;

export const siteInputSchema = z.object({
  name: z.string().trim().min(1),
  sortOrder: z.number().int().optional().default(0),
  driveFolderUrl: z.string().trim().optional().nullable(),
  sheetSummary: sheetSummarySchema.optional().nullable(),
  stages: z.array(stageInputSchema),
});
export type SiteInput = z.infer<typeof siteInputSchema>;

export const deptLinkInputSchema = z.object({
  department: z.string().trim().min(1),
  site: z.string().trim().min(1),
  stage: z.string().trim().min(1),
  url: z.string().trim().min(1),
});
export type DeptLinkInput = z.infer<typeof deptLinkInputSchema>;

export const startBodySchema = z.object({
  requestId: z.string().trim().min(1).nullable(),
  trigger: triggerSchema,
  sheetName: z.string().trim().min(1),
  sheetId: z.string().trim().min(1),
  siteCount: z.number().int().min(0),
  deptLinks: z.array(deptLinkInputSchema).default([]),
});
export type StartBody = z.infer<typeof startBodySchema>;

export const chunkBodySchema = z.object({
  runId: z.string().trim().min(1),
  site: siteInputSchema,
});
export type ChunkBody = z.infer<typeof chunkBodySchema>;

export const finishBodySchema = z.object({
  runId: z.string().trim().min(1),
  expected: z.object({
    sites: z.number().int().min(0),
  }),
});
export type FinishBody = z.infer<typeof finishBodySchema>;

export const failBodySchema = z.object({
  runId: z.string().trim().min(1),
  message: z.string().trim().min(1),
});
export type FailBody = z.infer<typeof failBodySchema>;
