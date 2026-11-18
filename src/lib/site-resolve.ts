import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeSiteName } from "@/lib/dashboard-site-input";

/**
 * Unified sync: resolve the site names a sheet uses to shared `Site` rows,
 * creating the ones that don't exist yet. Three legs run in parallel and all
 * may meet the same new site, so resolution (and creation) is serialised by a
 * short advisory lock — never held inside a leg's long commit transaction.
 *
 * Match order: normalised exact name -> SiteAlias (spelling differences such
 * as "Tulsi Hissar" / "Tulsi Hisar") -> create. A website-created (`WEB-`)
 * site is never adopted: it is returned flagged `websiteOwned` so the caller
 * skips it (owner decision 1: sheet wins only for sheet-origin sites).
 */

export type SiteForResolve = {
  id: string;
  name: string;
  sourceKey: string;
  isActive: boolean;
  usedInTracker: boolean;
};

export type ResolvedSite = {
  id: string;
  name: string;
  websiteOwned: boolean;
  /** True only when this call created the row. */
  created: boolean;
};

export type SiteResolution = {
  /** normalised sheet name -> resolved site (every requested name is present). */
  byNorm: Map<string, ResolvedSite>;
  /** Display names of the sites this call auto-created. */
  created: string[];
};

export type ResolveOptions = {
  /** Flags a newly created site starts with. */
  newSite: { usedInBoq: boolean; usedInTracker: boolean };
  /** Mark matched sheet-origin sites as tracker sites too. */
  ensureUsedInTracker?: boolean;
};

export const WEB_SOURCE_PREFIX = "WEB-";

export function isWebsiteSourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith(WEB_SOURCE_PREFIX);
}

/** Display name for a sheet-supplied name (trim + collapse whitespace, keep case). */
export function cleanSiteName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

type Plan = {
  matched: Map<string, ResolvedSite>;
  /** normalised name -> display name, in first-seen order. */
  toCreate: Map<string, string>;
  /** Ids of matched sheet-origin sites that still need usedInTracker = true. */
  needTracker: string[];
};

/**
 * Pure: decide, for each requested name, whether it matches an existing site
 * (by name, then alias), or must be created. No I/O.
 */
export function planSiteResolution(
  names: readonly string[],
  sites: readonly SiteForResolve[],
  aliases: readonly { aliasNorm: string; siteId: string }[],
  ensureUsedInTracker: boolean
): Plan {
  const byName = new Map(sites.map((s) => [normalizeSiteName(s.name), s]));
  const byId = new Map(sites.map((s) => [s.id, s]));
  const aliasTarget = new Map(aliases.map((a) => [a.aliasNorm, byId.get(a.siteId)]));

  const matched = new Map<string, ResolvedSite>();
  const toCreate = new Map<string, string>();
  const needTracker = new Set<string>();

  for (const raw of names) {
    const display = cleanSiteName(raw);
    if (!display) continue;
    const norm = normalizeSiteName(display);
    if (matched.has(norm) || toCreate.has(norm)) continue;

    const site = byName.get(norm) ?? aliasTarget.get(norm);
    if (!site) {
      toCreate.set(norm, display);
      continue;
    }
    const websiteOwned = isWebsiteSourceKey(site.sourceKey);
    matched.set(norm, { id: site.id, name: site.name, websiteOwned, created: false });
    if (ensureUsedInTracker && !websiteOwned && !site.usedInTracker) needTracker.add(site.id);
  }

  return { matched, toCreate, needTracker: [...needTracker] };
}

type Db = Pick<PrismaClient, "$transaction">;

/**
 * Resolve (and create missing) sites for a list of sheet names. Runs one short
 * transaction under an advisory lock so parallel legs can't both create the
 * same site. Call it BEFORE the leg's big commit transaction.
 */
export async function resolveOrCreateSites(
  db: Db,
  names: readonly string[],
  options: ResolveOptions
): Promise<SiteResolution> {
  return db.$transaction(
    async (tx) => {
      // $executeRaw, not $queryRaw: the function returns `void`, which Prisma cannot deserialize as a result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fone-site-resolve'))`;
      return resolveInTx(tx, names, options);
    },
    { timeout: 30_000, maxWait: 30_000 }
  );
}

async function resolveInTx(
  tx: Prisma.TransactionClient,
  names: readonly string[],
  options: ResolveOptions
): Promise<SiteResolution> {
  const [sites, aliases] = await Promise.all([
    tx.site.findMany({
      select: { id: true, name: true, sourceKey: true, isActive: true, usedInTracker: true },
    }),
    tx.siteAlias.findMany({ select: { aliasNorm: true, siteId: true } }),
  ]);

  const plan = planSiteResolution(names, sites, aliases, options.ensureUsedInTracker === true);

  if (plan.needTracker.length > 0) {
    await tx.site.updateMany({ where: { id: { in: plan.needTracker } }, data: { usedInTracker: true } });
  }

  const created: string[] = [];
  if (plan.toCreate.size > 0) {
    const maxSort = await tx.site.aggregate({ _max: { sortOrder: true } });
    let nextSort = (maxSort._max.sortOrder ?? -1) + 1;
    const rows = [...plan.toCreate.values()].map((name) => ({
      sourceKey: `SHEET-${randomUUID()}`,
      name,
      sortOrder: nextSort++,
      usedInBoq: options.newSite.usedInBoq,
      usedInTracker: options.newSite.usedInTracker,
    }));
    // skipDuplicates: a name that raced in under a different case/spacing than
    // our normalised match still hits the unique(name) index — treat it as
    // "already exists" and pick it up in the re-select below instead of failing.
    await tx.site.createMany({ data: rows, skipDuplicates: true });

    const fresh = await tx.site.findMany({
      where: { name: { in: rows.map((r) => r.name) } },
      select: { id: true, name: true, sourceKey: true },
    });
    const createdKeys = new Set(rows.map((r) => r.sourceKey));
    for (const site of fresh) {
      const norm = normalizeSiteName(site.name);
      const wasCreated = createdKeys.has(site.sourceKey);
      if (wasCreated) created.push(site.name);
      plan.matched.set(norm, {
        id: site.id,
        name: site.name,
        websiteOwned: isWebsiteSourceKey(site.sourceKey),
        created: wasCreated,
      });
    }
  }

  return { byNorm: plan.matched, created };
}
