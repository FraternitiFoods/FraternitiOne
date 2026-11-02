import { db } from "@/lib/db";
import type { TrackerStepStatus } from "@prisma/client";

export type TrackerImportRow = {
  siteName: string;
  stepCode: string;
  status?: string;
  assignee?: string | null;
  remark?: string | null;
};

export type TrackerImportResult = {
  counts: {
    rows: number;
    processed: number;
    /** A row referencing a site/step/status this DB doesn't recognize. */
    skippedUnknown: number;
    /** site-tracker-plan.md section 7: "skip rows that were already edited on the website unless overwrite: true." */
    skippedAlreadyEdited: number;
  };
  warnings: string[];
};

const STATUS_ALIASES: Record<string, TrackerStepStatus> = {
  "NOT STARTED": "NOT_STARTED",
  NOT_STARTED: "NOT_STARTED",
  "IN PROGRESS": "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETED",
  COMPLETED: "COMPLETED",
  "NOT REQUIRED": "NOT_REQUIRED",
  NOT_REQUIRED: "NOT_REQUIRED",
};

function normalizeStatus(value: string | undefined): TrackerStepStatus | undefined | null {
  if (value === undefined) return undefined;
  return STATUS_ALIASES[value.trim().toUpperCase()] ?? null;
}

/**
 * site-tracker-plan.md section 7, Phase 2 (milestone T6, optional): bulk
 * status push from the live sheet. Upsert by site name + step code — never
 * creates sites/steps, only links to what the website seed already has.
 * Imported COMPLETED sets legacyCompleted = true (exempt from the evidence
 * rule) and is never cleared back by a later import. Rows a real user has
 * already edited on the website (TrackerSiteStep.updatedById set by the
 * PATCH route, never by this import) are left alone unless `overwrite`.
 */
export async function importTrackerRows(rows: TrackerImportRow[], overwrite: boolean): Promise<TrackerImportResult> {
  const warnings: string[] = [];
  let processed = 0;
  let skippedUnknown = 0;
  let skippedAlreadyEdited = 0;

  for (const row of rows) {
    const siteName = row.siteName.trim();
    const stepCode = row.stepCode.trim();

    const site = await db.site.findFirst({
      where: { name: { equals: siteName, mode: "insensitive" }, usedInTracker: true },
    });
    if (!site) {
      warnings.push(`Unknown site "${siteName}" — row skipped.`);
      skippedUnknown++;
      continue;
    }

    const step = await db.trackerStep.findUnique({ where: { code: stepCode } });
    if (!step) {
      warnings.push(`Unknown step code "${stepCode}" — row skipped.`);
      skippedUnknown++;
      continue;
    }

    const status = normalizeStatus(row.status);
    if (status === null) {
      warnings.push(`Unknown status "${row.status}" for "${siteName}" / "${stepCode}" — row skipped.`);
      skippedUnknown++;
      continue;
    }

    const existing = await db.trackerSiteStep.findUnique({
      where: { siteId_stepId: { siteId: site.id, stepId: step.id } },
    });
    if (existing?.updatedById && !overwrite) {
      skippedAlreadyEdited++;
      continue;
    }

    const assignee = row.assignee !== undefined ? row.assignee?.trim() || null : undefined;
    const remark = row.remark !== undefined ? row.remark?.trim() || null : undefined;
    const becomingCompleted = status === "COMPLETED" && existing?.status !== "COMPLETED";
    const leavingCompleted = status !== undefined && status !== "COMPLETED" && existing?.status === "COMPLETED";

    await db.trackerSiteStep.upsert({
      where: { siteId_stepId: { siteId: site.id, stepId: step.id } },
      update: {
        ...(status !== undefined ? { status, legacyCompleted: status === "COMPLETED" ? true : existing?.legacyCompleted ?? false } : {}),
        ...(assignee !== undefined ? { assignee } : {}),
        ...(remark !== undefined ? { remark } : {}),
        ...(becomingCompleted ? { completedAt: new Date() } : {}),
        ...(leavingCompleted ? { completedAt: null, completedById: null } : {}),
      },
      create: {
        siteId: site.id,
        stepId: step.id,
        status: status ?? "NOT_STARTED",
        legacyCompleted: status === "COMPLETED",
        completedAt: status === "COMPLETED" ? new Date() : null,
        assignee: assignee ?? null,
        remark: remark ?? null,
      },
    });
    processed++;
  }

  return {
    counts: { rows: rows.length, processed, skippedUnknown, skippedAlreadyEdited },
    warnings,
  };
}
