import "server-only";

import type { Prisma, PrismaClient, SyncLegKind } from "@prisma/client";

/**
 * Per-unit content hashes for the unified sync (owner decision 8). The Apps
 * Script sends a SHA-256 of each unit it extracted (a dashboard site, a BOQ
 * tab, an ops tab). A unit whose hash equals the last COMMITTED one is not
 * rewritten.
 *
 * Bump SERVER_SYNC_VERSION whenever the server-side interpretation of a unit
 * changes (new column mapped, new derivation...): every stored hash then stops
 * matching and the next sync rewrites everything once. `force: true` on the
 * batch does the same for a single run.
 */
export const SERVER_SYNC_VERSION = "1";

export type ManifestEntry = { key: string; hash: string };

export function stampHash(scriptHash: string): string {
  return `${SERVER_SYNC_VERSION}:${scriptHash}`;
}

/**
 * Pure: which manifest units must be (re)written.
 * A unit is "changed" when forced, never synced, its hash differs, or the
 * caller says its target row is missing/inactive (`mustRewrite`) — so a site
 * archived on the website, or a deleted tab's rows, never stay stale just
 * because the sheet itself did not change.
 */
export function splitChanged(
  manifest: readonly ManifestEntry[],
  stored: ReadonlyMap<string, string>,
  options: { force?: boolean; mustRewrite?: ReadonlySet<string> } = {}
): { changed: string[]; unchanged: string[] } {
  const changed: string[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (seen.has(entry.key)) continue; // duplicate key in one manifest: first wins
    seen.add(entry.key);
    const isChanged =
      options.force === true ||
      options.mustRewrite?.has(entry.key) === true ||
      stored.get(entry.key) !== stampHash(entry.hash);
    (isChanged ? changed : unchanged).push(entry.key);
  }
  return { changed, unchanged };
}

export async function loadStoredHashes(
  db: Pick<PrismaClient, "syncContentHash">,
  leg: SyncLegKind,
  keys: readonly string[]
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db.syncContentHash.findMany({
    where: { leg, unitKey: { in: [...keys] } },
    select: { unitKey: true, hash: true },
  });
  return new Map(rows.map((r) => [r.unitKey, r.hash]));
}

/**
 * Record committed hashes. Call inside the SAME transaction as the data write
 * so a failed commit never leaves a hash that claims the data is current.
 * One statement for any number of units.
 */
export async function commitHashes(
  tx: Prisma.TransactionClient,
  leg: SyncLegKind,
  entries: readonly ManifestEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  const keys = entries.map((e) => e.key);
  const hashes = entries.map((e) => stampHash(e.hash));
  await tx.$executeRaw`
    INSERT INTO "SyncContentHash" ("leg", "unitKey", "hash", "updatedAt")
    SELECT ${leg}::"SyncLegKind", k, h, now()
    FROM unnest(${keys}::text[], ${hashes}::text[]) AS t(k, h)
    ON CONFLICT ("leg", "unitKey") DO UPDATE SET "hash" = EXCLUDED."hash", "updatedAt" = now()
  `;
}
