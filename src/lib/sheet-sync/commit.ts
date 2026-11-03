import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SyncError } from "./errors";
import type { ChunkTab, SiteStartInput } from "./schema";

type Tx = Prisma.TransactionClient;

export type CommitCounts = {
  sites: number;
  vendors: number;
  categories: number;
  items: number;
  vendorRates: number;
  siteItems: number;
  deactivatedSites: number;
  deactivatedItems: number;
};

/** Batch size for the bulk VALUES-list upserts — large enough to cut round
 * trips dramatically (a 680-item/3000-site-entry run goes from thousands of
 * individual upserts to a few dozen batched statements), small enough to
 * stay well under Postgres's parameter limit and keep each statement fast.
 */
const BATCH_SIZE = 250;

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rate rules (plan.md section 3, reused here): 0 or empty both mean "missing" — never stored as 0. */
function normalizeRate(value: number | string | null | undefined): number | null {
  return toNullableNumber(value) || null;
}

function parseDateOrWarn(label: string, value: string | null | undefined, warnings: string[]): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    warnings.push(`"${label}" has an unparseable date "${trimmed}" — stored as empty.`);
    return null;
  }
  return date;
}

const VENDOR_NAME_WARNING_PATTERN = /confirm|quote|\(q-\d+|\d{1,2}-[a-z]{3}-\d{2,4}/i;
function isPlaceholderOrQuoteVendorName(name: string): boolean {
  return VENDOR_NAME_WARNING_PATTERN.test(name);
}

/** plan.md section 3: "create rows only when something is non-empty." qty > 0 counts; qty = 0 alone does not. */
function siteEntryHasData(entry: {
  qty?: number | string | null;
  remark?: string | null;
  remarks?: string | null;
  stage?: string | null;
  trackedAmount?: number | string | null;
  boqLink?: string | null;
  poLink?: string | null;
  approvedVia?: string | null;
  link?: string | null;
  advGiven?: number | string | null;
  followUp?: string | null;
}): boolean {
  const qty = toNullableNumber(entry.qty);
  if (qty && qty > 0) return true;
  if (toNullableNumber(entry.trackedAmount)) return true;
  if (toNullableNumber(entry.advGiven)) return true;
  const textFields = [entry.remark, entry.remarks, entry.boqLink, entry.poLink, entry.approvedVia, entry.link, entry.stage, entry.followUp];
  return textFields.some((value) => typeof value === "string" && value.trim() !== "");
}

type SiteRef = { id: string; isLocked: boolean };

/**
 * Sites (docs/sheet-sync/CLAUDE_CODE_HANDOFF.md section 5): matched by
 * normalised name (this contract has no stable per-site key, unlike items),
 * created if no match, archived (usedInBoq = false, never deleted) if
 * previously synced but no longer in sites[]. sheetLocked is the sheet's own
 * "order delivered/locked" flag — distinct from the website-native isLocked,
 * which this never touches.
 */
async function upsertSites(
  tx: Tx,
  runId: string,
  sites: SiteStartInput[],
  lockedSiteNames: string[],
  warnings: string[]
): Promise<{ byNormName: Map<string, SiteRef>; archivedCount: number }> {
  const lockedSet = new Set(lockedSiteNames.map(normalizeName));
  const existing = await tx.site.findMany();
  const byNormName = new Map(existing.map((s) => [normalizeName(s.name), s]));

  const result = new Map<string, SiteRef>();
  for (const input of sites) {
    const norm = normalizeName(input.name);
    const sheetLocked = lockedSet.has(norm);
    const openingDate = parseDateOrWarn(`Site "${input.name}"`, input.openingDate, warnings);
    const current = byNormName.get(norm);

    if (current) {
      await tx.site.update({
        where: { id: current.id },
        data: {
          name: input.name.trim(),
          shortCode: trimOrNull(input.shortCode),
          note: trimOrNull(input.note) ?? current.note,
          openingDate,
          sortOrder: input.position ?? current.sortOrder,
          usedInBoq: true,
          lastSeenRunId: runId,
          sheetLocked,
        },
      });
      result.set(norm, { id: current.id, isLocked: current.isLocked });
    } else {
      const created = await tx.site.create({
        data: {
          sourceKey: `SHEET-${randomUUID()}`,
          name: input.name.trim(),
          shortCode: trimOrNull(input.shortCode),
          note: trimOrNull(input.note),
          openingDate,
          sortOrder: input.position ?? 0,
          usedInBoq: true,
          lastSeenRunId: runId,
          sheetLocked,
        },
      });
      result.set(norm, { id: created.id, isLocked: false });
    }
  }

  const seenIds = new Set([...result.values()].map((v) => v.id));
  const toArchive = existing.filter((s) => s.usedInBoq && s.lastSeenRunId !== null && !seenIds.has(s.id));
  if (toArchive.length > 0) {
    await tx.site.updateMany({ where: { id: { in: toArchive.map((s) => s.id) } }, data: { usedInBoq: false } });
  }

  return { byNormName: result, archivedCount: toArchive.length };
}

/**
 * Vendors referenced anywhere in this run (tab.vendors[] + every item's
 * finalVendor/vendorRates keys), upserted once in bulk. createMany with
 * skipDuplicates never touches an existing vendor's contact fields — same
 * guarantee src/lib/import/boq-import.ts's upsertVendorByName makes, just
 * batched instead of one upsert per name.
 */
async function upsertVendors(
  tx: Tx,
  tabs: ChunkTab[],
  warnings: string[]
): Promise<Map<string, { id: string }>> {
  const names = new Set<string>();
  for (const tab of tabs) {
    for (const v of tab.vendors) {
      const trimmed = v.trim();
      if (trimmed) names.add(trimmed);
    }
    for (const item of tab.items) {
      const fv = item.finalVendor?.trim();
      if (fv) names.add(fv);
      for (const vn of Object.keys(item.vendorRates ?? {})) {
        const trimmed = vn.trim();
        if (trimmed) names.add(trimmed);
      }
    }
  }

  const nameList = [...names];
  const flagged = new Set<string>();
  for (const name of nameList) {
    if (isPlaceholderOrQuoteVendorName(name) && !flagged.has(name)) {
      flagged.add(name);
      warnings.push(`Vendor name looks like a placeholder or quote, not a confirmed vendor: "${name}".`);
    }
  }

  if (nameList.length > 0) {
    for (const batch of chunkArray(nameList, BATCH_SIZE)) {
      await tx.vendor.createMany({ data: batch.map((name) => ({ name })), skipDuplicates: true });
    }
  }
  const rows = nameList.length > 0 ? await tx.vendor.findMany({ where: { name: { in: nameList } } }) : [];
  return new Map(rows.map((v) => [v.name, v]));
}

type ItemRow = {
  id: string;
  sourceKey: string;
  categoryId: string;
  name: string;
  note: string | null;
  finalVendorId: string | null;
  sortOrder: number;
};

/** Bulk upsert by sourceKey (= the sheet's itemKey), RETURNING id so vendorRate/siteItem rows below can reference it. sizeNote is deliberately never written — it's website-native (plan.md section 4.3's Admin item form), not part of this payload. */
async function bulkUpsertItems(tx: Tx, runId: string, rows: ItemRow[]): Promise<Map<string, string>> {
  const idBySourceKey = new Map<string, string>();
  for (const batch of chunkArray(rows, BATCH_SIZE)) {
    const values = batch.map(
      (r) =>
        Prisma.sql`(${r.id}, ${r.sourceKey}, ${r.categoryId}, ${r.name}, ${r.note}, ${r.finalVendorId}, ${r.sortOrder}, true, ${runId}, now(), now())`
    );
    const query = Prisma.sql`
      INSERT INTO "Item" (id, "sourceKey", "categoryId", name, note, "finalVendorId", "sortOrder", "isActive", "lastSeenRunId", "createdAt", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("sourceKey") DO UPDATE SET
        "categoryId" = EXCLUDED."categoryId",
        name = EXCLUDED.name,
        note = EXCLUDED.note,
        "finalVendorId" = EXCLUDED."finalVendorId",
        "sortOrder" = EXCLUDED."sortOrder",
        "isActive" = true,
        "lastSeenRunId" = EXCLUDED."lastSeenRunId",
        "updatedAt" = now()
      RETURNING id, "sourceKey"
    `;
    const result = await tx.$queryRaw<{ id: string; sourceKey: string }[]>(query);
    for (const row of result) idBySourceKey.set(row.sourceKey, row.id);
  }
  return idBySourceKey;
}

type VendorRateRow = { itemId: string; vendorId: string; rate: number | null };

async function bulkUpsertVendorRates(tx: Tx, rows: VendorRateRow[]): Promise<void> {
  for (const batch of chunkArray(rows, BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const values = batch.map((r) => Prisma.sql`(${randomUUID()}, ${r.itemId}, ${r.vendorId}, ${r.rate}::numeric, now(), now())`);
    const query = Prisma.sql`
      INSERT INTO "VendorRate" (id, "itemId", "vendorId", rate, "createdAt", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("itemId", "vendorId") DO UPDATE SET rate = EXCLUDED.rate, "updatedAt" = now()
    `;
    await tx.$executeRaw(query);
  }
}

type SiteItemRow = {
  siteId: string;
  itemId: string;
  qty: number;
  remarkSize: string | null;
  poAmount: number | null;
  boqLink: string | null;
  poLink: string | null;
  approvedVia: string | null;
  link: string | null;
  advanceGiven: number | null;
  stage: string | null;
  followUp: string | null;
  remarks: string | null;
};

/** rateOverride/lockedRate are never in the SET list — Postgres's ON CONFLICT DO UPDATE leaves unlisted columns untouched, same guarantee as the old importer's typed upsert. */
async function bulkUpsertSiteItems(tx: Tx, rows: SiteItemRow[]): Promise<void> {
  for (const batch of chunkArray(rows, BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const values = batch.map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.siteId}, ${r.itemId}, ${r.qty}::numeric, ${r.remarkSize}, ${r.poAmount}::numeric, ${r.boqLink}, ${r.poLink}, ${r.approvedVia}, ${r.link}, ${r.advanceGiven}::numeric, ${r.stage}, ${r.followUp}, ${r.remarks}, now(), now())`
    );
    const query = Prisma.sql`
      INSERT INTO "SiteItem" (id, "siteId", "itemId", qty, "remarkSize", "poAmount", "boqLink", "poLink", "approvedVia", "link", "advanceGiven", stage, "followUp", remarks, "createdAt", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("siteId", "itemId") DO UPDATE SET
        qty = EXCLUDED.qty,
        "remarkSize" = EXCLUDED."remarkSize",
        "poAmount" = EXCLUDED."poAmount",
        "boqLink" = EXCLUDED."boqLink",
        "poLink" = EXCLUDED."poLink",
        "approvedVia" = EXCLUDED."approvedVia",
        "link" = EXCLUDED."link",
        "advanceGiven" = EXCLUDED."advanceGiven",
        stage = EXCLUDED.stage,
        "followUp" = EXCLUDED."followUp",
        remarks = EXCLUDED.remarks,
        "updatedAt" = now()
    `;
    await tx.$executeRaw(query);
  }
}

/**
 * "Sheet is boss" (user's explicit instruction): a SiteItem row for a
 * sheet-origin item that the sheet no longer has data for gets deleted
 * outright, not just zeroed — matches the model's documented invariant
 * ("one row per (site, item) that has at least one non-empty field").
 * Scoped to this chunk's own item ids and keep-pairs (not the whole run) to
 * keep each statement's size bounded.
 *
 * Two deliberate exclusions, both "frozen, not stale": a website-locked
 * site's rows (skipped entirely above, never in keepPairs, but not actually
 * missing from the sheet — never touch them); and any site that dropped out
 * of this run's sites[] entirely (archived — usedInBoq is already false by
 * the time this runs, set earlier in the same transaction). Handoff section
 * 5/test 7: an archived site's old tracking data must survive, just like an
 * archived item's does — only a site still active in this run's sites[] can
 * have a specific item's row cleared for being missing from *that item's*
 * payload.
 */
async function deleteStaleSiteItems(tx: Tx, itemIds: string[], keepPairs: { siteId: string; itemId: string }[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  const eligibleSitesClause = Prisma.sql`"siteId" IN (SELECT id FROM "Site" WHERE "isLocked" = false AND "usedInBoq" = true)`;

  if (keepPairs.length === 0) {
    const result = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "SiteItem"
      WHERE "itemId" IN (${Prisma.join(itemIds)})
        AND ${eligibleSitesClause}
    `);
    return Number(result);
  }

  const keepValues = keepPairs.map((p) => Prisma.sql`(${p.siteId}::text, ${p.itemId}::text)`);
  const result = await tx.$executeRaw(Prisma.sql`
    DELETE FROM "SiteItem"
    WHERE "itemId" IN (${Prisma.join(itemIds)})
      AND ${eligibleSitesClause}
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES ${Prisma.join(keepValues)}) AS keep(site_id, item_id)
        WHERE keep.site_id = "SiteItem"."siteId" AND keep.item_id = "SiteItem"."itemId"
      )
  `);
  return Number(result);
}

async function processCategoryChunk(
  tx: Tx,
  runId: string,
  category: { id: string; name: string },
  tab: ChunkTab,
  vendorByName: Map<string, { id: string }>,
  siteByNormName: Map<string, SiteRef>,
  warnings: string[]
): Promise<{ items: number; vendorRates: number; siteItems: number; staleDeleted: number }> {
  for (const vendorName of tab.vendors) {
    const vendor = vendorByName.get(vendorName.trim());
    if (!vendor) continue;
    await tx.categoryVendor.upsert({
      where: { categoryId_vendorId: { categoryId: category.id, vendorId: vendor.id } },
      update: {},
      create: { categoryId: category.id, vendorId: vendor.id },
    });
  }

  const nameCounts = new Map<string, number>();
  for (const item of tab.items) {
    const key = item.name.trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const warnedDuplicates = new Set<string>();

  const itemRows: ItemRow[] = tab.items.map((item) => {
    const trimmedName = item.name.trim();
    const dup = nameCounts.get(trimmedName) ?? 1;
    if (dup > 1 && !warnedDuplicates.has(trimmedName)) {
      warnedDuplicates.add(trimmedName);
      warnings.push(`Duplicate item name "${trimmedName}" appears ${dup} times in category "${tab.category}".`);
    }
    const finalVendorName = item.finalVendor?.trim();
    const finalVendor = finalVendorName ? vendorByName.get(finalVendorName) : null;
    return {
      id: randomUUID(),
      sourceKey: item.itemKey.trim(),
      categoryId: category.id,
      name: trimmedName,
      note: trimOrNull(item.notes),
      finalVendorId: finalVendor?.id ?? null,
      sortOrder: item.sNo ?? 0,
    };
  });

  const idBySourceKey = await bulkUpsertItems(tx, runId, itemRows);

  const vendorRateRows: VendorRateRow[] = [];
  for (const item of tab.items) {
    const itemId = idBySourceKey.get(item.itemKey.trim());
    if (!itemId) continue;
    for (const [vendorName, rawRate] of Object.entries(item.vendorRates ?? {})) {
      const vendor = vendorByName.get(vendorName.trim());
      if (!vendor) continue;
      vendorRateRows.push({ itemId, vendorId: vendor.id, rate: normalizeRate(rawRate) });
    }
  }
  await bulkUpsertVendorRates(tx, vendorRateRows);

  const siteItemRows: SiteItemRow[] = [];
  const keepPairs: { siteId: string; itemId: string }[] = [];
  const warnedLocked = new Set<string>();
  for (const item of tab.items) {
    const itemId = idBySourceKey.get(item.itemKey.trim());
    if (!itemId) continue;
    for (const [siteName, entry] of Object.entries(item.sites ?? {})) {
      const site = siteByNormName.get(normalizeName(siteName));
      if (!site) {
        warnings.push(`Item "${item.name.trim()}" references unknown site "${siteName}" — site entry skipped.`);
        continue;
      }
      if (site.isLocked) {
        if (!warnedLocked.has(site.id)) {
          warnedLocked.add(site.id);
          warnings.push(
            `A locked site's qty/tracking updates from the sheet for category "${tab.category}" were skipped. Unlock the site to resync.`
          );
        }
        continue;
      }
      if (!siteEntryHasData(entry)) continue;

      keepPairs.push({ siteId: site.id, itemId });
      siteItemRows.push({
        siteId: site.id,
        itemId,
        qty: toNullableNumber(entry.qty) ?? 0,
        remarkSize: trimOrNull(entry.remark),
        poAmount: toNullableNumber(entry.trackedAmount),
        boqLink: trimOrNull(entry.boqLink),
        poLink: trimOrNull(entry.poLink),
        approvedVia: trimOrNull(entry.approvedVia),
        link: trimOrNull(entry.link),
        advanceGiven: toNullableNumber(entry.advGiven),
        stage: trimOrNull(entry.stage),
        followUp: trimOrNull(entry.followUp),
        remarks: trimOrNull(entry.remarks),
      });
    }
  }
  await bulkUpsertSiteItems(tx, siteItemRows);

  const staleDeleted = await deleteStaleSiteItems(tx, [...idBySourceKey.values()], keepPairs);

  return { items: tab.items.length, vendorRates: vendorRateRows.length, siteItems: siteItemRows.length, staleDeleted };
}

export type CommitResult = { counts: CommitCounts; warnings: string[] };

/**
 * Handoff section 0/3: "finish = one DB transaction: replace live Site-BOQ
 * data with the staged data." Reads every staging row for the run, commits
 * in one transaction (large timeout — user's instruction: the heavy work
 * here is batched/bulk, not thousands of one-row-at-a-time upserts), then
 * the caller deletes the staging rows. Throws SyncError on any validation
 * failure (unknown runId, wrong state, missing sites payload) — the route
 * layer turns that into a failed run + alert email, never a partial commit.
 */
export async function commitRun(runId: string, expected: { tabs: number; items: number; sites: number }): Promise<CommitResult> {
  const run = await db.importRun.findUnique({ where: { id: runId }, include: { stagingChunks: true } });
  if (!run) throw new SyncError(404, `Unknown runId "${runId}".`);
  if (run.status !== "IN_PROGRESS") throw new SyncError(400, `Run "${runId}" is not in progress (status: ${run.status}).`);

  const sitesPayload = run.sitesPayload as { sites: SiteStartInput[]; lockedSites: string[] } | null;
  if (!sitesPayload) throw new SyncError(400, "Run has no sites payload — was /start called?");

  if (run.stagingChunks.length !== expected.tabs) {
    throw new SyncError(
      409,
      `Expected ${expected.tabs} category chunks but ${run.stagingChunks.length} were staged — not committing.`
    );
  }
  const totalStagedItems = run.stagingChunks.reduce((sum, c) => sum + ((c.payload as ChunkTab).items?.length ?? 0), 0);
  if (totalStagedItems !== expected.items) {
    throw new SyncError(409, `Expected ${expected.items} items but ${totalStagedItems} were staged — not committing.`);
  }
  if (sitesPayload.sites.length !== expected.sites) {
    throw new SyncError(409, `Expected ${expected.sites} sites but ${sitesPayload.sites.length} were staged — not committing.`);
  }

  const warnings: string[] = [];

  return db.$transaction(
    async (tx) => {
      const { byNormName: siteByNormName, archivedCount: deactivatedSites } = await upsertSites(
        tx,
        runId,
        sitesPayload.sites,
        sitesPayload.lockedSites,
        warnings
      );

      const categories = await tx.category.findMany();
      const categoryByName = new Map(categories.map((c) => [c.name, c]));

      const tabs = run.stagingChunks.map((c) => c.payload as ChunkTab);
      const vendorByName = await upsertVendors(tx, tabs, warnings);

      let items = 0;
      let vendorRates = 0;
      let siteItems = 0;
      let categoriesProcessed = 0;

      for (const chunk of run.stagingChunks) {
        const tab = chunk.payload as ChunkTab;
        const category = categoryByName.get(tab.category);
        if (!category) {
          warnings.push(`Unknown category "${tab.category}" — categories are seeded, not created by sync. Chunk skipped.`);
          continue;
        }
        const result = await processCategoryChunk(tx, runId, category, tab, vendorByName, siteByNormName, warnings);
        items += result.items;
        vendorRates += result.vendorRates;
        siteItems += result.siteItems;
        categoriesProcessed += 1;
      }

      // Items that previously synced from the sheet but weren't in this run
      // at all (whole item removed, not just a site entry) — archive, never
      // delete, so photos/POs survive (handoff section 4). Same lastSeenRunId
      // sweep src/lib/import/boq-import.ts's finishImportRun uses; manually
      // created (WEB-...) items are untouched since they never have
      // lastSeenRunId set.
      const deactivatedItemsResult = await tx.item.updateMany({
        where: { isActive: true, lastSeenRunId: { not: null }, NOT: { lastSeenRunId: runId } },
        data: { isActive: false },
      });

      return {
        counts: {
          sites: sitesPayload.sites.length,
          vendors: vendorByName.size,
          categories: categoriesProcessed,
          items,
          vendorRates,
          siteItems,
          deactivatedSites,
          deactivatedItems: deactivatedItemsResult.count,
        },
        warnings,
      };
    },
    { timeout: 180_000, maxWait: 30_000 }
  );
}
