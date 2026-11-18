import "server-only";

import type { Prisma } from "@prisma/client";
import type { SiteInput } from "./schema";

/**
 * Unified sync: Stage 7 ("Construction Execution") of the site stages sheet is
 * ALSO the Site Tracker's data — the tracker's 177 steps have codes like
 * 7.2.5 and the Dashboard's Stage 7 labels start with the same code
 * ("7.1.2 Site condition inspection"). Instead of a second Apps Script payload
 * (and the old per-row /api/import/tracker, ~12k round trips), the server
 * derives tracker rows from the Stage 7 data it just received, in the same
 * transaction, with ONE bulk statement.
 *
 * Rules (owner decision 6), mirroring src/lib/import/tracker-import.ts:
 *  - a row the website has edited (updatedById set) is never touched;
 *  - sheet COMPLETED => legacyCompleted = true (evidence-exempt) and sticky;
 *  - a tracker row is only CREATED for a non-"Not started" step or one with a
 *    remark (the tracker is lazy: no row means NOT_STARTED); an existing row is
 *    always updated so a step moved back in the sheet follows.
 */

export type TrackerStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED";

export type DerivedTrackerRow = {
  code: string;
  status: TrackerStatus;
  assignee: string | null;
  remark: string | null;
};

const STAGE_7 = 7;
/** Tracker's one synthetic step (prisma/seed-data/site-tracker-steps.json): no code in the sheet's label. */
const DEEP_CLEANING_CODE = "7.18.1";
const CODE_AT_START = /^\s*(7\.\d+\.\d+)(?![\d.])/;

const STATUS_MAP: Record<string, TrackerStatus> = {
  "Not started": "NOT_STARTED",
  "In progress": "IN_PROGRESS",
  Completed: "COMPLETED",
  "Not required": "NOT_REQUIRED",
};

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/** The tracker step code a Stage 7 leaf maps to, or null (parents, unmatched labels). */
export function trackerCodeForLabel(label: string): string | null {
  const m = CODE_AT_START.exec(label);
  if (m) return m[1];
  if (label.trim().replace(/\s+/g, " ").toLowerCase() === "deep cleaning") return DEEP_CLEANING_CODE;
  return null;
}

/** Pure: a site's Stage 7 leaves -> tracker rows (one per code; the first occurrence of a code wins). */
export function deriveTrackerRows(site: Pick<SiteInput, "stages">): DerivedTrackerRow[] {
  const rows = new Map<string, DerivedTrackerRow>();
  for (const stage of site.stages) {
    if (stage.stageNo !== STAGE_7) continue;
    for (const step of stage.steps) {
      if (step.isParent) continue;
      const code = trackerCodeForLabel(step.label);
      if (!code || rows.has(code)) continue;
      rows.set(code, {
        code,
        status: (step.status && STATUS_MAP[step.status]) || "NOT_STARTED",
        assignee: clean(step.assignedTo),
        remark: clean(step.remark),
      });
    }
  }
  return [...rows.values()];
}

export type TrackerTarget = { siteId: string; rows: DerivedTrackerRow[] };

/**
 * One statement for every changed site. Returns the number of tracker rows
 * inserted or updated (rows skipped because the website edited them, or that
 * did not change, are not counted).
 */
export async function applyTrackerRows(tx: Prisma.TransactionClient, targets: readonly TrackerTarget[]): Promise<number> {
  const siteIds: string[] = [];
  const codes: string[] = [];
  const statuses: string[] = [];
  const assignees: (string | null)[] = [];
  const remarks: (string | null)[] = [];
  for (const t of targets) {
    for (const r of t.rows) {
      siteIds.push(t.siteId);
      codes.push(r.code);
      statuses.push(r.status);
      assignees.push(r.assignee);
      remarks.push(r.remark);
    }
  }
  if (siteIds.length === 0) return 0;

  return tx.$executeRaw`
    INSERT INTO "TrackerSiteStep"
      ("id", "siteId", "stepId", "status", "assignee", "remark", "completedAt", "legacyCompleted", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, v.site_id, ts."id", v.status::"TrackerStepStatus", v.assignee, v.remark,
           CASE WHEN v.status = 'COMPLETED' THEN now() ELSE NULL END,
           (v.status = 'COMPLETED'), now(), now()
    FROM unnest(${siteIds}::text[], ${codes}::text[], ${statuses}::text[], ${assignees}::text[], ${remarks}::text[])
         AS v(site_id, code, status, assignee, remark)
    JOIN "TrackerStep" ts ON ts."code" = v.code
    WHERE v.status <> 'NOT_STARTED' OR v.remark IS NOT NULL
       OR EXISTS (SELECT 1 FROM "TrackerSiteStep" e WHERE e."siteId" = v.site_id AND e."stepId" = ts."id")
    ON CONFLICT ("siteId", "stepId") DO UPDATE SET
      "status" = EXCLUDED."status",
      "assignee" = EXCLUDED."assignee",
      "remark" = EXCLUDED."remark",
      "legacyCompleted" = "TrackerSiteStep"."legacyCompleted" OR EXCLUDED."legacyCompleted",
      "completedAt" = CASE
        WHEN EXCLUDED."status" = 'COMPLETED' AND "TrackerSiteStep"."status" <> 'COMPLETED' THEN now()
        WHEN EXCLUDED."status" <> 'COMPLETED' AND "TrackerSiteStep"."status" = 'COMPLETED' THEN NULL
        ELSE "TrackerSiteStep"."completedAt" END,
      "completedById" = CASE
        WHEN EXCLUDED."status" <> 'COMPLETED' AND "TrackerSiteStep"."status" = 'COMPLETED' THEN NULL
        ELSE "TrackerSiteStep"."completedById" END,
      "updatedAt" = now()
    WHERE "TrackerSiteStep"."updatedById" IS NULL
      AND ("TrackerSiteStep"."status" IS DISTINCT FROM EXCLUDED."status"
        OR "TrackerSiteStep"."assignee" IS DISTINCT FROM EXCLUDED."assignee"
        OR "TrackerSiteStep"."remark" IS DISTINCT FROM EXCLUDED."remark")
  `;
}
