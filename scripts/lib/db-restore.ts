import type { PrismaClient } from "@prisma/client";

/**
 * Snapshot / restore of the tables that a full-snapshot import (BOQ import,
 * sheet-sync, dashboard sync) or a fixture push can change. See
 * `scripts/db-restore.ts` (the CLI) and CLAUDE.md, "Test data and the `.env`
 * database", rule 3.
 *
 * How it works: the snapshot is a copy of each table inside the SAME database,
 * in the schema `e2e_snapshot` (`CREATE TABLE ... AS TABLE`, server-side, so it
 * is fast and survives a crashed script or a closed terminal). Restore then
 * puts the live tables back to exactly that copy, in place and by primary key:
 *   1. delete rows that did not exist at snapshot time (fixture rows, new runs),
 *   2. re-insert rows that existed but are gone,
 *   3. update rows whose values differ,
 * all in ONE transaction that re-checks "live == snapshot" before committing;
 * if anything still differs it rolls back and leaves the snapshot in place.
 *
 * Why in place, not delete-all + re-insert: Site is referenced by tracker data
 * (TrackerSiteStep, evidence) with ON DELETE CASCADE, so deleting real Site
 * rows would destroy data that no snapshot of ours contains.
 *
 * Deliberately NOT covered (the scripts clean these themselves, see
 * throwaway-admin.ts): User, Session, AuditEvent, Tracker* tables, staging
 * chunks (they cascade with their run), DashboardSiteAssignment.
 * Known limit: a real user changing these tables while a script runs would be
 * reverted too — this is for the single-owner preview DB.
 */

export const SNAPSHOT_SCHEMA = "e2e_snapshot";

/** Parents before children: insert/update go in this order, delete in reverse. */
export const RESTORE_TABLES = [
  "Category",
  "Vendor",
  "Site",
  "Item",
  "CategoryVendor",
  "ItemPhoto",
  "VendorRate",
  "SiteItem",
  "PurchaseOrder",
  "PoLine",
  "ImportRun",
  "AppSetting",
  "DashboardSyncRun",
  "DashboardSite",
  "DashboardStep",
  "DashboardDeptLink",
] as const;

const TX_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Executor = PrismaClient | Tx;

interface TableMeta {
  table: string;
  columns: string[];
  pk: string[];
}

export interface TableDiff {
  table: string;
  changed: number; // exists in both, values differ
  added: number; // in live, not in snapshot
  removed: number; // in snapshot, not in live
}

export interface SnapshotInfo {
  takenAt: Date;
}

const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const live = (t: string) => `public.${q(t)}`;
const snap = (t: string) => `${q(SNAPSHOT_SCHEMA)}.${q(t)}`;
const tableList = RESTORE_TABLES.map((t) => `'${t}'`).join(", "); // constants above, not user input

async function loadMeta(db: Executor): Promise<TableMeta[]> {
  const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name in (${tableList})
     order by table_name, ordinal_position`
  );
  const pks = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `select c.relname as table_name, a.attname as column_name
     from pg_index i
     join pg_class c on c.oid = i.indrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
     where i.indisprimary and n.nspname = 'public' and c.relname in (${tableList})`
  );
  return RESTORE_TABLES.map((table) => {
    const columns = cols.filter((c) => c.table_name === table).map((c) => c.column_name);
    const pk = pks.filter((p) => p.table_name === table).map((p) => p.column_name);
    if (columns.length === 0) throw new Error(`Table "${table}" not found in the public schema — update RESTORE_TABLES in scripts/lib/db-restore.ts.`);
    if (pk.length === 0) throw new Error(`Table "${table}" has no primary key — cannot restore by key.`);
    return { table, columns, pk };
  });
}

const pkJoin = (m: TableMeta) => m.pk.map((c) => `s.${q(c)} = t.${q(c)}`).join(" and ");

export async function getSnapshotInfo(db: Executor): Promise<SnapshotInfo | null> {
  const ns = await db.$queryRawUnsafe<{ s: string | null }[]>(`select to_regnamespace('${SNAPSHOT_SCHEMA}')::text as s`);
  if (!ns[0]?.s) return null;
  const meta = await db.$queryRawUnsafe<{ taken_at: Date }[]>(`select taken_at from ${q(SNAPSHOT_SCHEMA)}._meta limit 1`).catch(() => []);
  return { takenAt: meta[0]?.taken_at ?? new Date(0) };
}

/** Takes the snapshot. Refuses if one already exists (never overwrite the only restore point). */
export async function takeSnapshot(db: PrismaClient): Promise<void> {
  if (await getSnapshotInfo(db)) {
    throw new Error(`A snapshot already exists in this database (schema ${SNAPSHOT_SCHEMA}). Run "restore" to put the data back (and remove it), or "drop" to discard it, before taking a new one.`);
  }
  const meta = await loadMeta(db);
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`create schema ${q(SNAPSHOT_SCHEMA)}`);
      for (const m of meta) await tx.$executeRawUnsafe(`create table ${snap(m.table)} as table ${live(m.table)}`);
      await tx.$executeRawUnsafe(`create table ${q(SNAPSHOT_SCHEMA)}._meta as select now() as taken_at`);
    },
    { ...TX_OPTIONS, isolationLevel: "RepeatableRead" } // one consistent point in time across all tables
  );
}

/** Per-table difference between the live tables and the snapshot. Read-only. */
export async function diffAgainstSnapshot(db: Executor, metaIn?: TableMeta[]): Promise<TableDiff[]> {
  if (!(await getSnapshotInfo(db))) throw new Error("No snapshot exists in this database.");
  const meta = metaIn ?? (await loadMeta(db));
  const out: TableDiff[] = [];
  for (const m of meta) {
    const [row] = await db.$queryRawUnsafe<{ changed: bigint; added: bigint; removed: bigint }[]>(
      `select
         (select count(*) from ${live(m.table)} t join ${snap(m.table)} s on ${pkJoin(m)} where row(t.*) is distinct from row(s.*)) as changed,
         (select count(*) from ${live(m.table)} t where not exists (select 1 from ${snap(m.table)} s where ${pkJoin(m)})) as added,
         (select count(*) from ${snap(m.table)} s where not exists (select 1 from ${live(m.table)} t where ${pkJoin(m)})) as removed`
    );
    out.push({ table: m.table, changed: Number(row.changed), added: Number(row.added), removed: Number(row.removed) });
  }
  return out;
}

export const isClean = (diffs: TableDiff[]) => diffs.every((d) => d.changed + d.added + d.removed === 0);

/**
 * Restores the live tables to the snapshot and drops the snapshot. Returns what
 * it had to undo. Atomic: on any problem nothing is changed and the snapshot stays.
 */
export async function restoreFromSnapshot(db: PrismaClient): Promise<TableDiff[]> {
  if (!(await getSnapshotInfo(db))) throw new Error("No snapshot exists in this database — nothing to restore.");
  const meta = await loadMeta(db);
  return db.$transaction(async (tx) => {
    const before = await diffAgainstSnapshot(tx, meta);

    for (const m of [...meta].reverse()) {
      await tx.$executeRawUnsafe(
        `delete from ${live(m.table)} t where not exists (select 1 from ${snap(m.table)} s where ${pkJoin(m)})`
      );
    }
    for (const m of meta) {
      const cols = m.columns.map(q).join(", ");
      await tx.$executeRawUnsafe(
        `insert into ${live(m.table)} (${cols}) select ${m.columns.map((c) => `s.${q(c)}`).join(", ")} from ${snap(m.table)} s
         where not exists (select 1 from ${live(m.table)} t where ${pkJoin(m)})`
      );
      const setCols = m.columns.filter((c) => !m.pk.includes(c));
      if (setCols.length > 0) {
        await tx.$executeRawUnsafe(
          `update ${live(m.table)} t set ${setCols.map((c) => `${q(c)} = s.${q(c)}`).join(", ")}
           from ${snap(m.table)} s where ${pkJoin(m)} and row(t.*) is distinct from row(s.*)`
        );
      }
    }

    const after = await diffAgainstSnapshot(tx, meta);
    if (!isClean(after)) {
      throw new Error(`Restore did not reach the snapshot state (rolled back, snapshot kept): ${JSON.stringify(after.filter((d) => d.changed + d.added + d.removed > 0))}`);
    }
    await tx.$executeRawUnsafe(`drop schema ${q(SNAPSHOT_SCHEMA)} cascade`);
    return before;
  }, TX_OPTIONS);
}

/** Discards the snapshot without restoring (only when you are sure the live data is what you want). */
export async function dropSnapshot(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`drop schema if exists ${q(SNAPSHOT_SCHEMA)} cascade`);
}

/** The numbers worth eyeballing after a run: what a mass-deactivation would change. */
export async function keyCounts(db: Executor): Promise<Record<string, number>> {
  const [r] = await db.$queryRawUnsafe<Record<string, bigint>[]>(
    `select
       (select count(*) from "Item" where "isActive") as items_active,
       (select count(*) from "Item") as items_total,
       (select count(*) from "Site" where "usedInBoq") as boq_sites,
       (select count(*) from "Site") as sites_total,
       (select count(*) from "DashboardSite" where "isActive") as dashboard_sites_active,
       (select count(*) from "DashboardSite") as dashboard_sites_total,
       (select count(*) from "Category") as categories,
       (select count(*) from "Vendor") as vendors,
       (select count(*) from "ImportRun") as import_runs,
       (select count(*) from "DashboardSyncRun") as dashboard_sync_runs`
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}
