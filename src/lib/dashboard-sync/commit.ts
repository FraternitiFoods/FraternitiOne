import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeSiteStats, type LeafStepLike } from "@/lib/dashboard-calc";
import { resolveOrCreateSites } from "@/lib/site-resolve";
import { commitHashes } from "@/lib/sync-batch/hash";
import { DashboardSyncError } from "./errors";
import type { DeptLinkInput, ManifestEntryInput, SheetSummary, SiteInput, StepInput } from "./schema";
import { applyTrackerRows, deriveTrackerRows, type TrackerTarget } from "./tracker-derive";

type Tx = Prisma.TransactionClient;

export type CommitCounts = {
  /** Sites rewritten this run (the changed ones when a unified-sync manifest was sent). */
  sites: number;
  steps: number;
  deptLinks: number;
  deactivatedSites: number;
  /** Unified sync: sites the script listed but whose content hash was unchanged (not rewritten). */
  unchangedSites: number;
  /** Unified sync: Site Tracker rows inserted/updated from Stage 7. */
  trackerRows: number;
};

export type CommitResult = {
  counts: CommitCounts;
  warnings: string[];
  mismatches: Record<string, unknown>;
  /** Shared Site rows auto-created for sheet names that matched nothing (duplicate-spelling check). */
  createdSites: string[];
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const STATUS_MAP: Record<string, "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED"> = {
  "Not started": "NOT_STARTED",
  "In progress": "IN_PROGRESS",
  Completed: "COMPLETED",
  "Not required": "NOT_REQUIRED",
};

/** dashboard-sheet-sync-plan.md section 3: "A blank status on a leaf = Not started." Parents carry no status of their own. */
function toDbStatus(step: StepInput): "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED" | null {
  if (step.isParent) return null;
  if (!step.status) return "NOT_STARTED";
  return STATUS_MAP[step.status] ?? "NOT_STARTED";
}

type SiteRef = { id: string; name: string };

/**
 * Matched by normalised name (same approach as Site BOQ's sheet-sync — this
 * sheet has no stable per-site key either), created if no match, archived
 * (isActive = false, never deleted) if previously synced but missing from
 * this run's sites. dashboard-sheet-sync-plan.md section 2: show every site
 * exactly as in the sheet, including "trash"/Zoca ones — no filtering here.
 */
export async function upsertSites(
  tx: Tx,
  runId: string,
  sites: SiteInput[],
  /**
   * Unified sync: names the script listed in its manifest but did NOT chunk
   * (content unchanged). They are not rewritten, but they ARE "seen" — kept
   * active (never archived) and resolvable for dept-link siteIds.
   */
  seenOnlyNames: readonly string[] = []
): Promise<{ byNormName: Map<string, SiteRef>; archivedCount: number; skippedWebsiteSites: string[] }> {
  const existing = await tx.dashboardSite.findMany();
  const byNormName = new Map(existing.map((s) => [normalizeName(s.name), s]));

  const result = new Map<string, SiteRef>();
  const skippedWebsiteSites: string[] = [];
  const now = new Date();
  for (const input of sites) {
    const norm = normalizeName(input.name);
    const current = byNormName.get(norm);

    // Website-created sites are owned by the website: never updated, never
    // given the sheet's steps. Left out of `result` so replaceSiteSteps /
    // dept-link resolution skip them too.
    if (current?.origin === "WEBSITE") {
      skippedWebsiteSites.push(current.name);
      continue;
    }

    if (current) {
      await tx.dashboardSite.update({
        where: { id: current.id },
        data: {
          name: input.name.trim(),
          sortOrder: input.sortOrder,
          driveFolderUrl: trimOrNull(input.driveFolderUrl),
          sheetSummary: (input.sheetSummary ?? null) as Prisma.InputJsonValue | undefined,
          isActive: true,
          lastSeenRunId: runId,
          lastSyncedAt: now,
        },
      });
      result.set(norm, { id: current.id, name: input.name.trim() });
    } else {
      const created = await tx.dashboardSite.create({
        data: {
          name: input.name.trim(),
          sortOrder: input.sortOrder,
          driveFolderUrl: trimOrNull(input.driveFolderUrl),
          sheetSummary: (input.sheetSummary ?? null) as Prisma.InputJsonValue | undefined,
          isActive: true,
          lastSeenRunId: runId,
          lastSyncedAt: now,
        },
      });
      result.set(norm, { id: created.id, name: created.name });
    }
  }

  const unchangedIds: string[] = [];
  for (const name of seenOnlyNames) {
    const norm = normalizeName(name);
    const current = byNormName.get(norm);
    if (!current || current.origin !== "SHEET" || result.has(norm)) continue;
    unchangedIds.push(current.id);
    result.set(norm, { id: current.id, name: current.name });
  }
  if (unchangedIds.length > 0) {
    await tx.dashboardSite.updateMany({
      where: { id: { in: unchangedIds } },
      data: { isActive: true, lastSeenRunId: runId, lastSyncedAt: now },
    });
  }

  const seenIds = new Set([...result.values()].map((v) => v.id));
  const toArchive = existing.filter(
    (s) => s.origin === "SHEET" && s.isActive && s.lastSeenRunId !== null && !seenIds.has(s.id)
  );
  if (toArchive.length > 0) {
    await tx.dashboardSite.updateMany({ where: { id: { in: toArchive.map((s) => s.id) } }, data: { isActive: false } });
  }

  return { byNormName: result, archivedCount: toArchive.length, skippedWebsiteSites };
}

/**
 * "Old data of that site is replaced" (the user's own mental model, section
 * 1): delete every existing DashboardStep for this site and insert the
 * freshly-synced set, in one go — simpler and exactly as correct as a
 * merge-upsert here, since the sheet always sends the site's complete step
 * list in a single chunk (never a partial one).
 */
async function replaceSiteSteps(tx: Tx, site: SiteRef, input: SiteInput): Promise<number> {
  await tx.dashboardStep.deleteMany({ where: { siteId: site.id } });

  const rows = input.stages.flatMap((stage) =>
    stage.steps.map((step) => ({
      id: randomUUID(),
      siteId: site.id,
      stageNo: stage.stageNo,
      stageName: stage.stageName,
      stepKey: step.stepKey,
      parentKey: trimOrNull(step.parentKey),
      label: step.label.trim(),
      sortOrder: step.sortOrder,
      isParent: step.isParent,
      assignedTo: trimOrNull(step.assignedTo),
      status: toDbStatus(step),
      remark: trimOrNull(step.remark),
      shared: step.isParent ? false : step.shared,
      deliverables: step.deliverables as unknown as Prisma.InputJsonValue,
    }))
  );

  if (rows.length === 0) return 0;
  await tx.dashboardStep.createMany({ data: rows });
  return rows.length;
}

/**
 * Department Links tab (dashboard-sheet-sync-plan.md section 3): the whole
 * tab is small and sent once per run (on `start`, see run.ts), so it's a
 * full replace rather than a per-row upsert — same "sheet is boss" reasoning
 * as replaceSiteSteps above.
 */
async function replaceDeptLinks(tx: Tx, links: DeptLinkInput[], byNormName: Map<string, SiteRef>): Promise<number> {
  await tx.dashboardDeptLink.deleteMany({});
  if (links.length === 0) return 0;

  const rows = links.map((link) => {
    const site = byNormName.get(normalizeName(link.site));
    return {
      department: link.department.trim(),
      siteName: link.site.trim(),
      siteId: site?.id ?? null,
      stageFolderName: link.stage.trim(),
      url: link.url.trim(),
    };
  });
  await tx.dashboardDeptLink.createMany({ data: rows });
  return rows.length;
}

/** dashboard-sheet-sync-plan.md section 4: compare the sheet's own Dashboard-tab numbers against what we just computed from the synced steps. */
function diffSheetSummary(siteName: string, summary: SheetSummary | null | undefined, computed: ReturnType<typeof computeSiteStats>): Record<string, unknown> | null {
  if (!summary) return null;
  const diffs: Record<string, { sheet: number; computed: number }> = {};

  const check = (field: string, sheetValue: number | null | undefined, computedValue: number) => {
    if (sheetValue === null || sheetValue === undefined) return;
    if (Math.round(sheetValue) !== Math.round(computedValue)) {
      diffs[field] = { sheet: sheetValue, computed: computedValue };
    }
  };

  check("total", summary.total, computed.total);
  check("completed", summary.completed, computed.completed);
  check("inProgress", summary.inProgress, computed.inProgress);
  check("notStarted", summary.notStarted, computed.notStarted);
  check("notRequired", summary.notRequired, computed.notRequired);
  check("shared", summary.shared, computed.shared);
  check("notShared", summary.notShared, computed.notShared);

  const pctAsPercent = (value: number) => Math.round(value * (value <= 1 ? 100 : 1));
  if (summary.pct !== null && summary.pct !== undefined) {
    const sheetPct = pctAsPercent(summary.pct);
    const computedPct = Math.round(computed.pct * 100);
    if (sheetPct !== computedPct) diffs.pct = { sheet: sheetPct, computed: computedPct };
  }

  (summary.perStagePct ?? []).forEach((sheetPct, i) => {
    if (sheetPct === null || sheetPct === undefined) return;
    const stage = computed.perStage.find((s) => s.stageNo === i + 1);
    const computedPct = stage ? Math.round(stage.pct * 100) : 0;
    const sheetPctRounded = pctAsPercent(sheetPct);
    if (sheetPctRounded !== computedPct) {
      diffs[`stage${i + 1}Pct`] = { sheet: sheetPctRounded, computed: computedPct };
    }
  });

  return Object.keys(diffs).length > 0 ? { site: siteName, diffs } : null;
}

export async function commitRun(
  runId: string,
  expected: { sites: number }
): Promise<CommitResult> {
  const run = await db.dashboardSyncRun.findUnique({ where: { id: runId }, include: { stagingChunks: true } });
  if (!run) throw new DashboardSyncError(404, `Unknown runId "${runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new DashboardSyncError(400, `Run "${runId}" is not in progress (status: ${run.status}).`);
  }
  if (run.stagingChunks.length !== expected.sites) {
    throw new DashboardSyncError(
      409,
      `Expected ${expected.sites} site chunks but ${run.stagingChunks.length} were staged — not committing.`
    );
  }

  // Warnings recorded at /start (e.g. website-owned sites left out of the manifest) are kept.
  const warnings: string[] = Array.isArray(run.warnings) ? [...(run.warnings as string[])] : [];
  const mismatches: Record<string, unknown>[] = [];
  const deptLinks = (run.deptLinksPayload as DeptLinkInput[] | null) ?? [];
  const manifest = (run.manifestPayload as ManifestEntryInput[] | null) ?? null;
  const siteInputs = run.stagingChunks.map((c) => c.payload as unknown as SiteInput);

  const stagedNorms = new Set(siteInputs.map((s) => normalizeName(s.name)));
  const seenOnlyNames = manifest ? manifest.filter((m) => !stagedNorms.has(normalizeName(m.name))).map((m) => m.name) : [];

  // Shared Site rows for the Site Tracker (Stage 7). Resolved/created BEFORE the
  // big transaction — resolution takes a short advisory lock so the three
  // parallel legs can't create the same site twice. Website-created dashboard
  // sites are never given tracker data by the sheet, so they're left out.
  // Only for a unified-sync run (it sent a manifest): an old-style run (fixtures,
  // tmp-e2e scripts) must not start creating shared Sites or tracker rows.
  const unified = manifest !== null;
  const websiteNames = new Set(
    (await db.dashboardSite.findMany({ where: { origin: "WEBSITE" }, select: { name: true } })).map((s) => normalizeName(s.name))
  );
  const resolution = unified
    ? await resolveOrCreateSites(
        db,
        siteInputs.filter((s) => !websiteNames.has(normalizeName(s.name))).map((s) => s.name),
        { newSite: { usedInBoq: false, usedInTracker: true }, ensureUsedInTracker: true }
      )
    : { byNorm: new Map<string, { id: string; name: string; websiteOwned: boolean; created: boolean }>(), created: [] as string[] };

  const result = await db.$transaction(
    async (tx) => {
      const { byNormName, archivedCount, skippedWebsiteSites } = await upsertSites(tx, runId, siteInputs, seenOnlyNames);
      for (const name of skippedWebsiteSites) {
        warnings.push(`Skipped "${name}": a site with this name was created on the website, so the sheet's copy was ignored.`);
      }

      let steps = 0;
      const trackerTargets: TrackerTarget[] = [];
      const writtenNorms: string[] = [];
      for (const input of siteInputs) {
        const norm = normalizeName(input.name);
        const site = byNormName.get(norm);
        if (!site || !stagedNorms.has(norm) || websiteNames.has(norm)) continue;
        steps += await replaceSiteSteps(tx, site, input);
        writtenNorms.push(norm);

        const shared = resolution.byNorm.get(norm);
        if (shared && !shared.websiteOwned) {
          trackerTargets.push({ siteId: shared.id, rows: deriveTrackerRows(input) });
        } else if (shared?.websiteOwned) {
          warnings.push(`Tracker: "${input.name}" matches a website-created site, so its tracker rows were not touched.`);
        }

        const leaves: LeafStepLike[] = input.stages.flatMap((stage) =>
          stage.steps
            .filter((s) => !s.isParent)
            .map((s) => ({
              stageNo: stage.stageNo,
              isParent: false,
              status: toDbStatus(s),
              shared: s.shared,
            }))
        );
        const computed = computeSiteStats(leaves);
        const diff = diffSheetSummary(input.name, input.sheetSummary, computed);
        if (diff) mismatches.push(diff);
      }

      const deptLinksCount = await replaceDeptLinks(tx, deptLinks, byNormName);

      // Same transaction as the data: a hash is only ever recorded for a unit that was really written.
      let trackerRows = 0;
      if (unified) {
        trackerRows = await applyTrackerRows(tx, trackerTargets);
        const hashByNorm = new Map(manifest.map((m) => [normalizeName(m.name), m.hash]));
        await commitHashes(
          tx,
          "STAGES",
          writtenNorms.flatMap((norm) => {
            const hash = hashByNorm.get(norm);
            return hash ? [{ key: norm, hash }] : [];
          })
        );
      }

      return {
        counts: {
          sites: siteInputs.length, // staged count, as before (includes website sites skipped with a warning)
          steps,
          deptLinks: deptLinksCount,
          deactivatedSites: archivedCount,
          unchangedSites: seenOnlyNames.length,
          trackerRows,
        },
      };
    },
    { timeout: 120_000, maxWait: 30_000 }
  );

  return { counts: result.counts, warnings, mismatches: { entries: mismatches }, createdSites: resolution.created };
}
