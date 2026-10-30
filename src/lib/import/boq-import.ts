import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { uploadDocument, buildItemPhotoKey } from "@/lib/storage";
import { ImportError } from "./errors";
import type { SiteInput, VendorInput, CategoryChunkInput, SiteItemInput, PhotoBody } from "./schema";

type Tx = Prisma.TransactionClient;

export type ImportCounts = {
  sites: number;
  vendors: number;
  categories: number;
  items: number;
  vendorRates: number;
  siteItems: number;
  photos: number;
};

const ZERO_COUNTS: ImportCounts = {
  sites: 0,
  vendors: 0,
  categories: 0,
  items: 0,
  vendorRates: 0,
  siteItems: 0,
  photos: 0,
};

function mergeCounts(existing: unknown, delta: Partial<ImportCounts>): ImportCounts {
  const base: ImportCounts = {
    ...ZERO_COUNTS,
    ...(typeof existing === "object" && existing !== null ? (existing as Partial<ImportCounts>) : {}),
  };
  for (const [key, value] of Object.entries(delta)) {
    base[key as keyof ImportCounts] += value ?? 0;
  }
  return base;
}

function appendWarnings(existing: unknown, additions: string[]): string[] {
  const base = Array.isArray(existing) ? (existing as string[]) : [];
  return additions.length ? [...base, ...additions] : base;
}

/** number|string|null -> a finite number, or null for empty/unparseable. */
function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rate rules (plan.md section 3): 0 or empty both mean "missing" — never stored as 0. */
function normalizeRate(value: number | string | null | undefined): number | null {
  return toNullableNumber(value) || null;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

/**
 * plan.md section 7: "add a warning for names containing 'confirm' or a
 * quote/date pattern." Covers the three examples the plan gives: "Vendor 1
 * (confirm name)", "... quote (16-Jul-26)", "... (Q-398, 21-Jul-26)".
 */
const VENDOR_NAME_WARNING_PATTERN = /confirm|quote|\(q-\d+|\d{1,2}-[a-z]{3}-\d{2,4}/i;
function isPlaceholderOrQuoteVendorName(name: string): boolean {
  return VENDOR_NAME_WARNING_PATTERN.test(name);
}

async function upsertVendorByName(tx: Tx, name: string) {
  const trimmed = name.trim();
  // Never touches address/gstin/phone/email/note on an existing vendor —
  // plan.md section 7 is explicit that import must not overwrite them.
  return tx.vendor.upsert({
    where: { name: trimmed },
    update: {},
    create: { name: trimmed },
  });
}

/** plan.md section 3: "Create rows only when something is non-empty." qty > 0 counts; qty = 0 alone does not. */
function siteItemHasData(input: SiteItemInput): boolean {
  const qty = toNullableNumber(input.qty);
  if (qty && qty > 0) return true;
  if (toNullableNumber(input.poAmount)) return true;
  if (toNullableNumber(input.advanceGiven)) return true;
  const textFields = [
    input.remarkSize,
    input.boqLink,
    input.poLink,
    input.approvedVia,
    input.link,
    input.stage,
    input.followUp,
    input.remarks,
  ];
  return textFields.some((value) => typeof value === "string" && value.trim() !== "");
}

async function getRunOrThrow(tx: Tx, runId: string) {
  const run = await tx.importRun.findUnique({ where: { id: runId } });
  if (!run) throw new ImportError(404, `Unknown runId "${runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new ImportError(400, `Run "${runId}" is not in progress (status: ${run.status}).`);
  }
  return run;
}

/**
 * Wraps one chunk's writes in a single transaction (plan.md section 7: "A
 * whole finish is one transaction per category chunk at minimum; a failed
 * run must leave previous data intact") and persists this chunk's
 * counts/warnings onto the run atomically with those writes, so a rolled-
 * back chunk doesn't leave orphaned counts/warnings behind either.
 */
async function runChunk(
  runId: string,
  process: (tx: Tx) => Promise<{ counts: Partial<ImportCounts>; warnings: string[] }>
): Promise<{ counts: Partial<ImportCounts>; warnings: string[] }> {
  return db.$transaction(
    async (tx) => {
      const run = await getRunOrThrow(tx, runId);
      const result = await process(tx);

      await tx.importRun.update({
        where: { id: runId },
        data: {
          counts: mergeCounts(run.counts, result.counts),
          warnings: appendWarnings(run.warnings, result.warnings),
        },
      });

      return result;
    },
    { timeout: 30_000 }
  );
}

export async function createImportRun(dryRun: boolean) {
  return db.importRun.create({ data: { dryRun, counts: ZERO_COUNTS, warnings: [] } });
}

// Site lock (plan.md section 3 "Site lock") is website-native data: the
// upsert `update`/`create` payloads below never mention isLocked/lockedAt/
// lockedById, so Prisma never touches them here regardless of what the sheet
// sends.
export function runSitesChunk(runId: string, data: SiteInput[]) {
  return runChunk(runId, async (tx) => {
    const warnings: string[] = [];
    for (const site of data) {
      const openingDate = parseDateOrWarn(`Site "${site.name}"`, site.openingDate, warnings);
      await tx.site.upsert({
        where: { sourceKey: site.siteKey },
        update: {
          name: site.name,
          shortCode: trimOrNull(site.shortCode),
          openingDate,
          isActive: true,
          lastSeenRunId: runId,
        },
        create: {
          sourceKey: site.siteKey,
          name: site.name,
          shortCode: trimOrNull(site.shortCode),
          openingDate,
          lastSeenRunId: runId,
        },
      });
    }
    return { counts: { sites: data.length }, warnings };
  });
}

export function runVendorsChunk(runId: string, data: VendorInput[]) {
  return runChunk(runId, async (tx) => {
    const warnings: string[] = [];
    const flagged = new Set<string>();

    for (const vendor of data) {
      const vendorRow = await upsertVendorByName(tx, vendor.name);
      if (isPlaceholderOrQuoteVendorName(vendor.name) && !flagged.has(vendor.name)) {
        flagged.add(vendor.name);
        warnings.push(`Vendor name looks like a placeholder or quote, not a confirmed vendor: "${vendor.name}".`);
      }

      for (const categoryName of vendor.categories) {
        const category = await tx.category.findUnique({ where: { name: categoryName } });
        if (!category) {
          warnings.push(`Vendor "${vendor.name}" references unknown category "${categoryName}" — link skipped.`);
          continue;
        }
        await tx.categoryVendor.upsert({
          where: { categoryId_vendorId: { categoryId: category.id, vendorId: vendorRow.id } },
          update: {},
          create: { categoryId: category.id, vendorId: vendorRow.id },
        });
      }
    }

    return { counts: { vendors: data.length }, warnings };
  });
}

export function runCategoryChunk(runId: string, payload: CategoryChunkInput) {
  return runChunk(runId, async (tx) => {
    const warnings: string[] = [];
    const flaggedVendorNames = new Set<string>();

    const category = await tx.category.findUnique({ where: { name: payload.category } });
    if (!category) {
      throw new ImportError(
        400,
        `Unknown category "${payload.category}" — categories are seeded, not created by import.`
      );
    }

    await tx.category.update({
      where: { id: category.id },
      data: { group: payload.group === "operating" ? "OPERATING" : "INTERIOR" },
    });

    async function upsertVendorWithWarning(name: string) {
      const vendorRow = await upsertVendorByName(tx, name);
      if (isPlaceholderOrQuoteVendorName(name) && !flaggedVendorNames.has(name)) {
        flaggedVendorNames.add(name);
        warnings.push(`Vendor name looks like a placeholder or quote, not a confirmed vendor: "${name}".`);
      }
      return vendorRow;
    }

    for (const vendorName of payload.vendors) {
      const vendorRow = await upsertVendorWithWarning(vendorName);
      await tx.categoryVendor.upsert({
        where: { categoryId_vendorId: { categoryId: category.id, vendorId: vendorRow.id } },
        update: {},
        create: { categoryId: category.id, vendorId: vendorRow.id },
      });
    }

    // Same item name appearing more than once in this category (plan.md
    // section 7: "Japanese Cocktail Glass" x3 in Glassware).
    const nameCounts = new Map<string, number>();
    for (const item of payload.items) {
      const key = item.name.trim();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const warnedDuplicates = new Set<string>();
    const warnedCrossCategory = new Set<string>();
    const warnedLockedSites = new Set<string>();
    const occurrenceCounters = new Map<string, number>();

    let vendorRateCount = 0;
    let siteItemCount = 0;

    for (const item of payload.items) {
      const trimmedName = item.name.trim();

      const duplicateCount = nameCounts.get(trimmedName) ?? 1;
      if (duplicateCount > 1 && !warnedDuplicates.has(trimmedName)) {
        warnedDuplicates.add(trimmedName);
        warnings.push(
          `Duplicate item name "${trimmedName}" appears ${duplicateCount} times in category "${payload.category}".`
        );
      }

      let sourceKey = item.itemKey?.trim() || "";
      if (!sourceKey) {
        const occurrence = occurrenceCounters.get(trimmedName) ?? 0;
        occurrenceCounters.set(trimmedName, occurrence + 1);
        sourceKey = `${payload.category}::${trimmedName}::${occurrence}`;
        warnings.push(
          `Item "${trimmedName}" in category "${payload.category}" has no itemKey — using fallback key "${sourceKey}".`
        );
      }

      // Same name in another category (plan.md section 7: "Cream Siphon" in
      // both Kitchen Smallware and FOH & Bar) — flagged once per name per
      // chunk; not attempting to diff rates across categories here (the
      // plan's examples are illustrative, not a precise spec for that).
      if (!warnedCrossCategory.has(trimmedName)) {
        const existingElsewhere = await tx.item.findFirst({
          where: { name: trimmedName, categoryId: { not: category.id }, isActive: true },
          select: { category: { select: { name: true } } },
        });
        if (existingElsewhere) {
          warnedCrossCategory.add(trimmedName);
          warnings.push(
            `Item name "${trimmedName}" also exists in category "${existingElsewhere.category.name}" — possible duplicate across categories.`
          );
        }
      }

      let finalVendorId: string | null = null;
      const finalVendorName = item.finalVendor?.trim();
      if (finalVendorName) {
        const vendorRow = await upsertVendorWithWarning(finalVendorName);
        finalVendorId = vendorRow.id;
      }

      const itemRow = await tx.item.upsert({
        where: { sourceKey },
        update: {
          name: trimmedName,
          categoryId: category.id,
          finalVendorId,
          isActive: true,
          lastSeenRunId: runId,
        },
        create: {
          sourceKey,
          name: trimmedName,
          categoryId: category.id,
          finalVendorId,
          lastSeenRunId: runId,
        },
      });

      for (const [vendorName, rawRate] of Object.entries(item.rates)) {
        const vendorRow = await upsertVendorWithWarning(vendorName);
        const rate = normalizeRate(rawRate);
        await tx.vendorRate.upsert({
          where: { itemId_vendorId: { itemId: itemRow.id, vendorId: vendorRow.id } },
          update: { rate },
          create: { itemId: itemRow.id, vendorId: vendorRow.id, rate },
        });
        vendorRateCount += 1;
      }

      for (const siteEntry of item.sites) {
        const site = await tx.site.findUnique({ where: { sourceKey: siteEntry.siteKey } });
        if (!site) {
          warnings.push(
            `Item "${trimmedName}" references unknown siteKey "${siteEntry.siteKey}" — site_item skipped.`
          );
          continue;
        }

        // Site lock (plan.md section 3 "Site lock"): locking is website-
        // native, not a BOQ data edit, so the push is still accepted — but a
        // locked site's qty/tracking fields (and lockedRate) must never be
        // overwritten by the sheet. Skip this site_item entirely and warn
        // once per locked site per chunk, rather than once per item.
        if (site.isLocked) {
          if (!warnedLockedSites.has(site.id)) {
            warnedLockedSites.add(site.id);
            warnings.push(
              `Site "${site.name}" is locked — qty/tracking updates from the sheet for this site in category "${payload.category}" were skipped. Unlock the site to resync.`
            );
          }
          continue;
        }

        const hasData = siteItemHasData(siteEntry);
        const existing = await tx.siteItem.findUnique({
          where: { siteId_itemId: { siteId: site.id, itemId: itemRow.id } },
        });
        if (!hasData && !existing) continue;

        const fields = {
          qty: toNullableNumber(siteEntry.qty) ?? 0,
          remarkSize: trimOrNull(siteEntry.remarkSize),
          poAmount: toNullableNumber(siteEntry.poAmount),
          boqLink: trimOrNull(siteEntry.boqLink),
          poLink: trimOrNull(siteEntry.poLink),
          approvedVia: trimOrNull(siteEntry.approvedVia),
          link: trimOrNull(siteEntry.link),
          advanceGiven: toNullableNumber(siteEntry.advanceGiven),
          stage: trimOrNull(siteEntry.stage),
          followUp: trimOrNull(siteEntry.followUp),
          remarks: trimOrNull(siteEntry.remarks),
        };
        await tx.siteItem.upsert({
          where: { siteId_itemId: { siteId: site.id, itemId: itemRow.id } },
          // rateOverride is never written here — plan.md section 3: the
          // sheet has one rate for all sites, import must leave it null.
          update: fields,
          create: { siteId: site.id, itemId: itemRow.id, ...fields },
        });
        siteItemCount += 1;
      }
    }

    return {
      counts: {
        categories: 1,
        items: payload.items.length,
        vendorRates: vendorRateCount,
        siteItems: siteItemCount,
      },
      warnings,
    };
  });
}

export async function uploadImportPhoto(runId: string, input: PhotoBody) {
  // Verified before the (slow, external) upload so a bad runId/itemKey
  // fails fast without touching B2.
  const item = await db.$transaction((tx) => getItemOrThrow(tx, runId, input.itemKey));

  const buffer = Buffer.from(input.dataBase64, "base64");
  const storageKey = buildItemPhotoKey({ itemId: item.id, index: input.index, mimeType: input.mimeType });
  await uploadDocument({ key: storageKey, body: buffer, contentType: input.mimeType });

  await runChunk(runId, async (tx) => {
    await tx.itemPhoto.upsert({
      where: { itemId_sortOrder: { itemId: item.id, sortOrder: input.index } },
      update: { storageKey },
      create: { itemId: item.id, sortOrder: input.index, storageKey },
    });
    return { counts: { photos: 1 }, warnings: [] };
  });

  return { storageKey };
}

async function getItemOrThrow(tx: Tx, runId: string, itemKey: string) {
  await getRunOrThrow(tx, runId);
  const item = await tx.item.findUnique({ where: { sourceKey: itemKey } });
  if (!item) {
    throw new ImportError(
      400,
      `Unknown itemKey "${itemKey}" — push the item's category chunk before its photos.`
    );
  }
  return item;
}

export async function finishImportRun(runId: string) {
  return db.$transaction(async (tx) => {
    const run = await getRunOrThrow(tx, runId);

    let deactivatedSites = 0;
    let deactivatedItems = 0;

    if (!run.dryRun) {
      const sites = await tx.site.updateMany({
        where: { isActive: true, lastSeenRunId: { not: null }, NOT: { lastSeenRunId: runId } },
        data: { isActive: false },
      });
      deactivatedSites = sites.count;

      const items = await tx.item.updateMany({
        where: { isActive: true, lastSeenRunId: { not: null }, NOT: { lastSeenRunId: runId } },
        data: { isActive: false },
      });
      deactivatedItems = items.count;
    }

    const finished = await tx.importRun.update({
      where: { id: runId },
      data: { status: "COMMITTED", finishedAt: new Date() },
    });

    return { run: finished, deactivatedSites, deactivatedItems };
  });
}
