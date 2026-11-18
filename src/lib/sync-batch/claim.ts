import "server-only";

import type { PrismaClient, SyncLegKind } from "@prisma/client";

/**
 * Starting a unified-sync batch. One batch at a time: a second press while one
 * is running just attaches to it (duplicate clicks, two admins) — it never
 * stacks. Same row-lock mechanism as dashboard-sync/request-state.ts
 * (atomicUpdate): the lock lives on a dedicated AppSetting row, because Prisma
 * cannot express a "one unfinished batch" partial unique index and
 * `migrate dev` drift detection would try to drop one.
 */

const LOCK_KEY = "unifiedSyncLock";

/** A batch unfinished for longer than this is dead (Apps Script caps at 6 min, Vercel at 5): the next claim reaps it. */
export const BATCH_STALE_MS = 12 * 60 * 1000;

export const ALL_LEGS: readonly SyncLegKind[] = ["STAGES", "SITE_BOQ", "OPS_BOQ"];

export type ClaimResult = {
  batchId: string;
  /** False when an already-running batch was returned instead of a new one. */
  created: boolean;
  legs: SyncLegKind[];
};

type Db = Pick<PrismaClient, "$transaction">;

export async function claimBatch(
  db: Db,
  input: { userId: string | null; legs?: readonly SyncLegKind[]; force?: boolean; now?: Date }
): Promise<ClaimResult> {
  const now = input.now ?? new Date();
  const wanted = [...new Set(input.legs && input.legs.length > 0 ? input.legs : ALL_LEGS)];
  const staleBefore = new Date(now.getTime() - BATCH_STALE_MS);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "AppSetting" (key, value, "updatedAt")
        VALUES (${LOCK_KEY}, '{}'::jsonb, now())
        ON CONFLICT (key) DO NOTHING
      `;
      await tx.$queryRaw`SELECT value FROM "AppSetting" WHERE key = ${LOCK_KEY} FOR UPDATE`;

      // Dead batches: close them so they stop looking "active" to the UI.
      const stale = await tx.syncBatch.findMany({
        where: { finishedAt: null, startedAt: { lt: staleBefore } },
        select: { id: true },
      });
      if (stale.length > 0) {
        const ids = stale.map((b) => b.id);
        await tx.syncLeg.updateMany({
          where: { batchId: { in: ids }, status: "RUNNING" },
          data: { status: "FAILED", finishedAt: now, errorMessage: "Timed out — the sync never reported back." },
        });
        await tx.syncBatch.updateMany({ where: { id: { in: ids } }, data: { finishedAt: now } });
      }

      const running = await tx.syncBatch.findFirst({
        where: { finishedAt: null },
        orderBy: { startedAt: "desc" },
        select: { id: true, legs: { select: { leg: true } } },
      });
      if (running) {
        return { batchId: running.id, created: false, legs: running.legs.map((l) => l.leg) };
      }

      const batch = await tx.syncBatch.create({
        data: {
          triggeredById: input.userId,
          force: input.force === true,
          startedAt: now,
          legs: { create: wanted.map((leg) => ({ leg, startedAt: now })) },
        },
        select: { id: true },
      });
      return { batchId: batch.id, created: true, legs: wanted };
    },
    { timeout: 20_000, maxWait: 20_000 }
  );
}
