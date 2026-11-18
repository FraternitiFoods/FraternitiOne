import "server-only";

import type { Prisma, PrismaClient, SyncLegKind } from "@prisma/client";

/**
 * Leg bookkeeping for a unified-sync batch. The existing per-sheet run modules
 * (dashboard-sync/run.ts, sheet-sync/run.ts) and the ops-boq-sync commit call
 * these when the script passed a `batchId`. Every function is a no-op when the
 * batch/leg is missing or already finished, so a plain (non-unified) run, or a
 * retried callback, is harmless.
 */

type Client = Pick<PrismaClient, "syncLeg" | "syncBatch" | "$executeRaw"> | Prisma.TransactionClient;

export type LegResult = {
  /** {units, changed, skipped, rows, trackerRows, ...} — shape is per leg. */
  counts?: Prisma.InputJsonValue;
  warnings?: string[];
  /** Names of sites this leg auto-created (duplicate-spelling check). */
  createdSites?: string[];
};

export async function attachRun(client: Client, batchId: string, leg: SyncLegKind, runId: string): Promise<void> {
  await client.syncLeg.updateMany({
    where: { batchId, leg, status: "RUNNING" },
    data: { runId },
  });
}

export async function completeLeg(
  client: Client,
  batchId: string,
  leg: SyncLegKind,
  result: LegResult = {}
): Promise<void> {
  await client.syncLeg.updateMany({
    where: { batchId, leg, status: "RUNNING" },
    data: {
      status: "COMMITTED",
      finishedAt: new Date(),
      counts: result.counts,
      warnings: result.warnings && result.warnings.length > 0 ? result.warnings : undefined,
      createdSites: result.createdSites && result.createdSites.length > 0 ? result.createdSites : undefined,
    },
  });
  await finalizeBatch(client, batchId);
}

export async function failLeg(client: Client, batchId: string, leg: SyncLegKind, message: string): Promise<void> {
  await client.syncLeg.updateMany({
    where: { batchId, leg, status: "RUNNING" },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage: message.slice(0, 500) },
  });
  await finalizeBatch(client, batchId);
}

/**
 * Close the batch once no leg is RUNNING. A single conditional UPDATE, so two
 * legs finishing at the same instant can't both (or neither) close it.
 */
export async function finalizeBatch(client: Client, batchId: string): Promise<void> {
  await client.$executeRaw`
    UPDATE "SyncBatch" SET "finishedAt" = now()
    WHERE "id" = ${batchId} AND "finishedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "SyncLeg" WHERE "batchId" = ${batchId} AND "status" = 'RUNNING')
  `;
}

/** Look up which batch (if any) a leg belongs to, from the run id a callback carries. */
export async function findBatchForRun(
  client: Pick<PrismaClient, "syncLeg">,
  leg: SyncLegKind,
  runId: string
): Promise<string | null> {
  const row = await client.syncLeg.findFirst({
    where: { leg, runId, status: "RUNNING" },
    select: { batchId: true },
  });
  return row?.batchId ?? null;
}
