import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Throwaway Site BOQ fixture for the tmp-e2e-m3/m5/m6 scripts, written straight
 * through Prisma (it used to be pushed through the sheet-import API, which is
 * gone). It only ever touches rows it owns, so it is safe on the shared preview
 * DB next to real data:
 *   - sites       sourceKey S-FIX-001..003, names "Fixture Site A/B/C"
 *   - items       sourceKey ITM-FIX-001..010, names end in " FIXTURE"
 *   - vendors     names end in " FIXTURE" (so they never collide with a real
 *                 "Gogia" etc. that already has contact details / items)
 * Categories normally come from `pnpm db:seed`; one that is missing is created
 * here (id FIX-CAT-n) and removed again — a seeded category is never touched.
 *
 * Always call removeBoqFixture() in a `finally`; seedBoqFixture() also calls it
 * first so a crashed earlier run cannot leave a collision behind.
 *
 * Hand-computed totals (also asserted by the scripts):
 *   Site A = 4,840 + 0 (Ladle Steel, missing rate) + 480 + 5,280 + 180,000 = 190,600
 *   Site B = 2,420 + 480 + 5,280 + 180,000 = 188,180
 *   Site C = 300 + 480 + 3,240 + 48,000 = 52,020
 */

const SUFFIX = " FIXTURE";

type FixtureSite = { sourceKey: string; name: string; shortCode: string; openingDate: string | null };
type FixtureItem = {
  sourceKey: string;
  name: string;
  vendor: string;
  /** 0 means "no rate" (stored as null, plan.md section 3 Rate rules). */
  rate: number;
  qtyBySite: Record<string, number>;
};
type FixtureCategory = { category: string; group: "OPERATING" | "INTERIOR"; vendor: string; items: FixtureItem[] };

const FIXTURE_CATEGORY_ID_PREFIX = "FIX-CAT-";

const SITES: FixtureSite[] = [
  { sourceKey: "S-FIX-001", name: "Fixture Site A", shortCode: "FXA", openingDate: "2026-12-01" },
  { sourceKey: "S-FIX-002", name: "Fixture Site B", shortCode: "FXB", openingDate: null },
  { sourceKey: "S-FIX-003", name: "Fixture Site C", shortCode: "FXC", openingDate: "2027-01-15" },
];

const CATEGORIES: FixtureCategory[] = [
  {
    category: "Kitchen Smallware",
    group: "OPERATING",
    vendor: `Gogia${SUFFIX}`,
    items: [
      { sourceKey: "ITM-FIX-001", name: `GN Pan${SUFFIX}`, vendor: `Gogia${SUFFIX}`, rate: 605, qtyBySite: { "S-FIX-001": 8, "S-FIX-002": 4 } },
      { sourceKey: "ITM-FIX-002", name: `Ladle Steel${SUFFIX}`, vendor: `Gogia${SUFFIX}`, rate: 0, qtyBySite: { "S-FIX-001": 10 } },
      { sourceKey: "ITM-FIX-003", name: `Measuring Cup${SUFFIX}`, vendor: `Gogia${SUFFIX}`, rate: 150, qtyBySite: { "S-FIX-003": 2 } },
      { sourceKey: "ITM-FIX-004", name: `Tongs${SUFFIX}`, vendor: `Gogia${SUFFIX}`, rate: 80, qtyBySite: { "S-FIX-001": 6, "S-FIX-002": 6, "S-FIX-003": 6 } },
    ],
  },
  {
    category: "Glassware",
    group: "OPERATING",
    vendor: `Crystal House${SUFFIX}`,
    items: [
      { sourceKey: "ITM-FIX-005", name: `Japanese Cocktail Glass${SUFFIX}`, vendor: `Crystal House${SUFFIX}`, rate: 220, qtyBySite: { "S-FIX-001": 24 } },
      { sourceKey: "ITM-FIX-006", name: `Japanese Cocktail Glass${SUFFIX}`, vendor: `Crystal House${SUFFIX}`, rate: 220, qtyBySite: { "S-FIX-002": 24 } },
      { sourceKey: "ITM-FIX-007", name: `Highball Glass${SUFFIX}`, vendor: `Crystal House${SUFFIX}`, rate: 180, qtyBySite: { "S-FIX-003": 18 } },
    ],
  },
  {
    category: "Furniture",
    group: "INTERIOR",
    vendor: `Wood Works${SUFFIX}`,
    items: [
      { sourceKey: "ITM-FIX-008", name: `Dining Chair${SUFFIX}`, vendor: `Wood Works${SUFFIX}`, rate: 4500, qtyBySite: { "S-FIX-001": 40 } },
      { sourceKey: "ITM-FIX-009", name: `Dining Table${SUFFIX}`, vendor: `Wood Works${SUFFIX}`, rate: 18000, qtyBySite: { "S-FIX-002": 10 } },
      { sourceKey: "ITM-FIX-010", name: `Bar Stool${SUFFIX}`, vendor: `Wood Works${SUFFIX}`, rate: 3200, qtyBySite: { "S-FIX-003": 15 } },
    ],
  },
];

const SITE_KEYS = SITES.map((s) => s.sourceKey);
const ITEM_KEYS = CATEGORIES.flatMap((c) => c.items.map((i) => i.sourceKey));
const VENDOR_NAMES = [...new Set(CATEGORIES.map((c) => c.vendor))];

/** Sort fixture rows after every real row so they never reorder real data. */
const SORT_BASE = 90_000;

export async function seedBoqFixture(db: PrismaClient): Promise<void> {
  await removeBoqFixture(db);
  try {
    await insertBoqFixture(db);
  } catch (e) {
    await removeBoqFixture(db).catch(() => {}); // never leave a half-seeded fixture behind
    throw e;
  }
}

/**
 * Few round trips on purpose: the preview DB is a remote Neon branch (~0.2 s per query, with
 * occasional multi-second stalls), so one query per row blows through any transaction timeout.
 * Ids are deterministic so relations can be built without reading ids back.
 */
async function insertBoqFixture(db: PrismaClient): Promise<void> {
  // Categories normally come from the seed. If one is missing (a fresh/preview DB that was never seeded)
  // create it with a FIXED id so `getActiveCategories()`'s 1-hour cache stays valid across script runs;
  // removeBoqFixture() deletes only the ones created here (id prefix FIX-CAT-).
  const existing = await db.category.findMany({ where: { name: { in: CATEGORIES.map((c) => c.category) } }, select: { id: true, name: true } });
  const categoryIds = new Map(existing.map((c) => [c.name, c.id]));
  const missing = CATEGORIES.map((c, i) => ({ c, i })).filter(({ c }) => !categoryIds.has(c.category));
  for (const { c, i } of missing) categoryIds.set(c.category, `${FIXTURE_CATEGORY_ID_PREFIX}${i + 1}`);

  const siteId = (key: string) => `FIX-SITE-${key}`;
  const vendorId = (name: string) => `FIX-VENDOR-${name}`;
  const itemId = (key: string) => `FIX-ITEM-${key}`;
  const allItems = CATEGORIES.flatMap((c) => c.items.map((it) => ({ cat: c, it })));

  await db.$transaction([
    db.category.createMany({
      data: missing.map(({ c, i }) => ({
        id: categoryIds.get(c.category)!,
        name: c.category,
        displayName: c.category,
        group: c.group,
        sortOrder: SORT_BASE + i,
      })),
    }),
    db.site.createMany({
      data: SITES.map((s, i) => ({
        id: siteId(s.sourceKey),
        sourceKey: s.sourceKey,
        name: s.name,
        shortCode: s.shortCode,
        openingDate: s.openingDate ? new Date(s.openingDate) : null,
        sortOrder: SORT_BASE + i,
      })),
    }),
    db.vendor.createMany({ data: VENDOR_NAMES.map((name) => ({ id: vendorId(name), name })) }),
    db.categoryVendor.createMany({
      data: CATEGORIES.map((c) => ({ categoryId: categoryIds.get(c.category)!, vendorId: vendorId(c.vendor) })),
    }),
    db.item.createMany({
      data: allItems.map(({ cat, it }, i) => ({
        id: itemId(it.sourceKey),
        sourceKey: it.sourceKey,
        categoryId: categoryIds.get(cat.category)!,
        name: it.name,
        finalVendorId: vendorId(it.vendor),
        sortOrder: SORT_BASE + i,
      })),
    }),
    db.vendorRate.createMany({
      data: allItems.map(({ it }) => ({ itemId: itemId(it.sourceKey), vendorId: vendorId(it.vendor), rate: it.rate === 0 ? null : it.rate })),
    }),
    db.siteItem.createMany({
      data: allItems.flatMap(({ it }) =>
        Object.entries(it.qtyBySite).map(([siteKey, qty]) => ({ siteId: siteId(siteKey), itemId: itemId(it.sourceKey), qty }))
      ),
    }),
  ]);
}

/**
 * Deletes everything seedBoqFixture() created, plus what the e2e scripts
 * themselves produced against it: purchase orders on fixture sites/vendors and
 * audit events about fixture rows (and, optionally, written by the throwaway
 * users in `actorEmails`). Idempotent; safe to call when nothing exists.
 */
export async function removeBoqFixture(db: PrismaClient, options: { actorEmails?: string[] } = {}): Promise<void> {
  const [sites, items, vendors] = await Promise.all([
    db.site.findMany({ where: { sourceKey: { in: SITE_KEYS } }, select: { id: true } }),
    db.item.findMany({ where: { sourceKey: { in: ITEM_KEYS } }, select: { id: true } }),
    db.vendor.findMany({ where: { name: { in: VENDOR_NAMES } }, select: { id: true } }),
  ]);
  const siteIds = sites.map((s) => s.id);
  const itemIds = items.map((i) => i.id);
  const vendorIds = vendors.map((v) => v.id);

  const siteItems = await db.siteItem.findMany({
    where: { OR: [{ siteId: { in: siteIds } }, { itemId: { in: itemIds } }] },
    select: { id: true },
  });
  const entityIds = [...siteIds, ...itemIds, ...vendorIds, ...siteItems.map((s) => s.id)];

  // PurchaseOrder -> Site/Vendor is onDelete: Restrict, so POs go first (PoLine cascades).
  await db.purchaseOrder.deleteMany({ where: { OR: [{ siteId: { in: siteIds } }, { vendorId: { in: vendorIds } }] } });

  const auditWhere: Prisma.AuditEventWhereInput[] = [{ entityId: { in: entityIds } }];
  if (options.actorEmails?.length) auditWhere.push({ actorEmail: { in: options.actorEmails } });
  await db.auditEvent.deleteMany({ where: { OR: auditWhere } });

  await db.item.deleteMany({ where: { id: { in: itemIds } } });
  await db.site.deleteMany({ where: { id: { in: siteIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  // Only categories this fixture created itself; a real/seeded category is never touched.
  await db.category.deleteMany({ where: { id: { startsWith: FIXTURE_CATEGORY_ID_PREFIX } } });
}

/** Counts of fixture rows still present — for the "prove the cleanup" report. */
export async function countBoqFixtureLeftovers(db: PrismaClient) {
  const [sites, items, vendors] = await Promise.all([
    db.site.count({ where: { sourceKey: { in: SITE_KEYS } } }),
    db.item.count({ where: { sourceKey: { in: ITEM_KEYS } } }),
    db.vendor.count({ where: { name: { in: VENDOR_NAMES } } }),
  ]);
  const categories = await db.category.count({ where: { id: { startsWith: FIXTURE_CATEGORY_ID_PREFIX } } });
  return { sites, items, vendors, categories };
}

/** AppSetting helpers so a script can put a setting (e.g. `mode`) back exactly as it found it. */
export async function readSetting(db: PrismaClient, key: string): Promise<Prisma.JsonValue | undefined> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value;
}

export async function restoreSetting(db: PrismaClient, key: string, previous: Prisma.JsonValue | undefined): Promise<void> {
  if (previous === undefined) {
    await db.appSetting.deleteMany({ where: { key } });
    return;
  }
  const value = previous as Prisma.InputJsonValue; // AppSetting.value is a required Json column, never null
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
