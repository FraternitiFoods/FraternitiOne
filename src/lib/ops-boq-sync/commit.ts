import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeSiteName } from "@/lib/dashboard-site-input";
import { ensureOpsBoqRows } from "@/lib/ops-boq-ensure";
import { resolveOrCreateSites } from "@/lib/site-resolve";
import { commitHashes, loadStoredHashes, splitChanged } from "@/lib/sync-batch/hash";
import { completeLeg, failLeg } from "@/lib/sync-batch/legs";
import { OpsBoqSyncError } from "./errors";
import { isSkippableRowName, matchTabRows, type ExistingOpsRow } from "./match";
import { normalizeOpsRow, type OpsRowValues } from "./row";
import type { CommitBody, FailBody, OpsRowInput, OpsTabInput } from "./schema";

/** A sheet with a few hundred cells can't produce thousands of warnings worth reading. */
const MAX_WARNINGS = 60;

export type OpsCommitCounts = {
  tabs: number;
  changedTabs: number;
  unchangedTabs: number;
  rowsUpdated: number;
  rowsAdded: number;
  rowsRemoved: number;
};

export type OpsCommitResult = { counts: OpsCommitCounts; warnings: string[]; createdSites: string[] };

type PlannedTab = {
  tab: OpsTabInput;
  norm: string;
  siteId: string;
  /** Sheet rows worth syncing (blank / TOTAL rows dropped), in sheet order. */
  rows: OpsRowInput[];
};

/**
 * POST /api/ops-boq-sync/commit — one atomic commit for the whole sheet (the
 * payload is ~13 tabs x ~12 rows, far below the Vercel body limit, so unlike
 * Site BOQ / Dashboard there is no start/chunk/finish staging).
 *
 * Owner decisions applied here: sheet wins, but ONLY for sheet-origin sites
 * (a website-created site's ops rows are left exactly as they are); a sheet row
 * is matched to the site's fixed row by category name, anything else becomes
 * that site's added row (`fromSheet`), and only such rows are ever deleted when
 * they leave the sheet. A blank sheet Vendor keeps the site's existing vendor
 * (the website's default-vendor prefill) instead of erasing it.
 */
export async function commitOpsBoq(body: CommitBody): Promise<OpsCommitResult> {
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
    else if (warnings.length === MAX_WARNINGS) warnings.push("…more warnings omitted.");
  };

  // Tabs with the same normalised name collapse to the first one.
  const byNorm = new Map<string, OpsTabInput>();
  for (const tab of body.tabs) {
    const norm = normalizeSiteName(tab.tabName);
    if (byNorm.has(norm)) warn(`Tab "${tab.tabName}" appears twice — the second one was ignored.`);
    else byNorm.set(norm, tab);
  }
  const keys = [...byNorm.keys()];

  const [stored, batch] = await Promise.all([
    loadStoredHashes(db, "OPS_BOQ", keys),
    body.batchId ? db.syncBatch.findUnique({ where: { id: body.batchId }, select: { force: true } }) : null,
  ]);
  const { changed, unchanged } = splitChanged(
    keys.map((key) => ({ key, hash: byNorm.get(key)!.hash })),
    stored,
    { force: batch?.force === true }
  );

  const changedTabs = changed.map((key) => byNorm.get(key)!);

  // Resolve (and create) the sites BEFORE the transaction, under the short advisory lock.
  const resolution =
    changedTabs.length > 0
      ? await resolveOrCreateSites(
          db,
          changedTabs.map((t) => t.tabName),
          { newSite: { usedInBoq: false, usedInTracker: false } }
        )
      : { byNorm: new Map(), created: [] as string[] };

  const planned: PlannedTab[] = [];
  for (const tab of changedTabs) {
    const norm = normalizeSiteName(tab.tabName);
    const site = resolution.byNorm.get(norm);
    if (!site) continue;
    if (site.websiteOwned) {
      warn(`Skipped tab "${tab.tabName}": a site with this name was created on the website, so the sheet's copy was ignored.`);
      continue;
    }
    planned.push({ tab, norm, siteId: site.id, rows: tab.rows.filter((r) => !isSkippableRowName(r.name)) });
  }

  const counts: OpsCommitCounts = {
    tabs: keys.length,
    changedTabs: planned.length,
    unchangedTabs: unchanged.length,
    rowsUpdated: 0,
    rowsAdded: 0,
    rowsRemoved: 0,
  };

  if (planned.length > 0) {
    await db.$transaction(
      async (tx) => {
        for (const p of planned) await ensureOpsBoqRows(tx, p.siteId);

        const existingRows = await tx.opsBoqRow.findMany({
          where: { siteId: { in: planned.map((p) => p.siteId) } },
          select: { id: true, siteId: true, name: true, fixedKey: true, fromSheet: true, sortOrder: true, sno: true },
        });
        const bySite = new Map<string, typeof existingRows>();
        for (const r of existingRows) {
          const list = bySite.get(r.siteId);
          if (list) list.push(r);
          else bySite.set(r.siteId, [r]);
        }

        const updates: { id: string; values: OpsRowValues }[] = [];
        const inserts: Prisma.OpsBoqRowCreateManyInput[] = [];
        const deleteIds: string[] = [];

        for (const p of planned) {
          const existing = bySite.get(p.siteId) ?? [];
          const forMatch: ExistingOpsRow[] = existing.map((r) => ({ id: r.id, name: r.name, fixedKey: r.fixedKey, fromSheet: r.fromSheet }));
          const match = matchTabRows(
            p.rows.map((r) => r.name),
            forMatch
          );
          const label = (r: OpsRowInput) => `Tab "${p.tab.tabName}", row "${r.name}"`;

          for (const m of match.matches) {
            const row = p.rows[m.sheetIndex];
            updates.push({ id: m.rowId, values: normalizeOpsRow(row, label(row), warn) });
          }

          let nextSort = existing.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
          let nextSno = existing.reduce((max, r) => (/^\d+$/.test(r.sno) ? Math.max(max, Number(r.sno)) : max), 0) + 1;
          for (const index of match.added) {
            const row = p.rows[index];
            const v = normalizeOpsRow(row, label(row), warn);
            const sheetSno = typeof row.sno === "string" || typeof row.sno === "number" ? String(row.sno).trim() : "";
            inserts.push({
              siteId: p.siteId,
              sno: sheetSno || String(nextSno++),
              name: row.name.trim().replace(/\s+/g, " ").slice(0, 200),
              isFixed: false,
              fromSheet: true,
              sortOrder: nextSort++,
              vendor: v.vendor,
              boqStatus: v.boqStatus,
              amount: v.amount,
              linkBoq: v.linkBoq,
              linkApprovedBoq: v.linkApprovedBoq,
              linkPo: v.linkPo,
              approvedVia: v.approvedVia,
              link: v.link,
              advanceGiven: v.advanceGiven,
              stage: v.stage,
              followUpDate: v.followUpDate ? new Date(`${v.followUpDate}T00:00:00.000Z`) : null,
              remarks: v.remarks,
            });
          }
          deleteIds.push(...match.staleRowIds);
        }

        await bulkUpdateRows(tx, updates);
        if (inserts.length > 0) await tx.opsBoqRow.createMany({ data: inserts });
        if (deleteIds.length > 0) await tx.opsBoqRow.deleteMany({ where: { id: { in: deleteIds }, fromSheet: true } });

        counts.rowsUpdated = updates.length;
        counts.rowsAdded = inserts.length;
        counts.rowsRemoved = deleteIds.length;

        // Same transaction as the data: a hash is only recorded for a tab that was really written.
        await commitHashes(
          tx,
          "OPS_BOQ",
          planned.map((p) => ({ key: p.norm, hash: p.tab.hash }))
        );
      },
      { timeout: 60_000, maxWait: 30_000 }
    );
  }

  return { counts, warnings, createdSites: resolution.created };
}

/** One UPDATE for every matched row. A blank sheet Vendor keeps the row's existing vendor; every other field is the sheet's value. */
async function bulkUpdateRows(tx: Prisma.TransactionClient, updates: readonly { id: string; values: OpsRowValues }[]): Promise<void> {
  if (updates.length === 0) return;
  const col = <T>(pick: (v: OpsRowValues) => T) => updates.map((u) => pick(u.values));
  const text = (n: number | null) => (n === null ? null : String(n));

  await tx.$executeRaw`
    UPDATE "OpsBoqRow" AS r SET
      "vendor" = COALESCE(v.vendor, r."vendor"),
      "boqStatus" = v.status::"OpsBoqStatus",
      "amount" = v.amount::numeric,
      "linkBoq" = v.link_boq,
      "linkApprovedBoq" = v.link_approved,
      "linkPo" = v.link_po,
      "approvedVia" = v.approved_via,
      "link" = v.link,
      "advanceGiven" = v.advance::numeric,
      "stage" = v.stage,
      "followUpDate" = v.follow_up::date,
      "remarks" = v.remarks,
      "updatedAt" = now()
    FROM unnest(
      ${updates.map((u) => u.id)}::text[],
      ${col((v) => v.vendor)}::text[],
      ${col((v) => v.boqStatus)}::text[],
      ${col((v) => text(v.amount))}::text[],
      ${col((v) => v.linkBoq)}::text[],
      ${col((v) => v.linkApprovedBoq)}::text[],
      ${col((v) => v.linkPo)}::text[],
      ${col((v) => v.approvedVia)}::text[],
      ${col((v) => v.link)}::text[],
      ${col((v) => text(v.advanceGiven))}::text[],
      ${col((v) => v.stage)}::text[],
      ${col((v) => v.followUpDate)}::text[],
      ${col((v) => v.remarks)}::text[]
    ) AS v(id, vendor, status, amount, link_boq, link_approved, link_po, approved_via, link, advance, stage, follow_up, remarks)
    WHERE r."id" = v.id
  `;
}

/** The route's whole job: commit, then close the leg. Any failure fails the leg (with a safe message) and rethrows for the HTTP error. */
export async function runOpsBoqCommit(body: CommitBody): Promise<OpsCommitResult> {
  let result: OpsCommitResult;
  try {
    result = await commitOpsBoq(body);
  } catch (err) {
    const message = err instanceof OpsBoqSyncError ? err.message : "Unexpected error while committing the Ops BOQ sync.";
    if (!(err instanceof OpsBoqSyncError)) console.error("Ops BOQ sync commit failed:", err);
    if (body.batchId) await failLeg(db, body.batchId, "OPS_BOQ", message);
    throw err instanceof OpsBoqSyncError ? err : new OpsBoqSyncError(500, message);
  }
  if (body.batchId) {
    await completeLeg(db, body.batchId, "OPS_BOQ", {
      counts: result.counts,
      warnings: result.warnings,
      createdSites: result.createdSites,
    });
  }
  return result;
}

/** POST /api/ops-boq-sync/fail — the script reporting its own failure (e.g. a tab it couldn't read). */
export async function failOpsBoq(body: FailBody): Promise<void> {
  await failLeg(db, body.batchId, "OPS_BOQ", body.message);
}
