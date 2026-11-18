import "server-only";

import type { PrismaClient, SyncLegKind } from "@prisma/client";

/**
 * Read-only status for the unified-sync button. Unlike the old
 * dashboard-sync/sheet-sync getStatus(), this NEVER writes (no reaping, no
 * alert emails): a leg still RUNNING after STATUS_TIMEOUT_MS is only *shown*
 * as timed out. Actually closing dead batches happens in claimBatch().
 */

export const STATUS_TIMEOUT_MS = 8 * 60 * 1000;

export type LegView = {
  leg: SyncLegKind;
  state: "running" | "done" | "failed";
  counts: unknown;
  createdSites: string[];
  warningCount: number;
  error: string | null;
};

export type SyncStatusView = {
  /** Null when no batch has ever run. */
  batchId: string | null;
  /** True while any leg is running (the UI polls only then). */
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  legs: LegView[];
  /** Latest time any leg committed — the key Ops BOQ uses to remount its table. */
  lastCommittedAt: string | null;
};

type BatchRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  legs: {
    leg: SyncLegKind;
    status: "RUNNING" | "COMMITTED" | "FAILED";
    startedAt: Date;
    finishedAt: Date | null;
    counts: unknown;
    warnings: unknown;
    createdSites: unknown;
    errorMessage: string | null;
  }[];
};

const LEG_ORDER: Record<SyncLegKind, number> = { STAGES: 0, SITE_BOQ: 1, OPS_BOQ: 2 };

/** Pure: turn a batch row into the response (testable without a DB). */
export function buildStatusView(batch: BatchRow | null, lastCommittedAt: Date | null, now: Date): SyncStatusView {
  if (!batch) {
    return { batchId: null, active: false, startedAt: null, finishedAt: null, legs: [], lastCommittedAt: iso(lastCommittedAt) };
  }
  const legs: LegView[] = [...batch.legs]
    .sort((a, b) => LEG_ORDER[a.leg] - LEG_ORDER[b.leg])
    .map((l) => {
      const timedOut = l.status === "RUNNING" && now.getTime() - l.startedAt.getTime() > STATUS_TIMEOUT_MS;
      return {
        leg: l.leg,
        state: timedOut || l.status === "FAILED" ? "failed" : l.status === "COMMITTED" ? "done" : "running",
        counts: l.counts ?? null,
        createdSites: Array.isArray(l.createdSites) ? (l.createdSites as string[]) : [],
        warningCount: Array.isArray(l.warnings) ? l.warnings.length : 0,
        error: timedOut ? "Timed out — the sync never reported back." : l.errorMessage,
      };
    });
  return {
    batchId: batch.id,
    active: legs.some((l) => l.state === "running"),
    startedAt: batch.startedAt.toISOString(),
    finishedAt: batch.finishedAt ? batch.finishedAt.toISOString() : null,
    legs,
    lastCommittedAt: iso(lastCommittedAt),
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export async function getSyncStatus(
  db: Pick<PrismaClient, "syncBatch" | "syncLeg">,
  now: Date = new Date()
): Promise<SyncStatusView> {
  const [batch, lastCommitted] = await Promise.all([
    db.syncBatch.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        legs: {
          select: {
            leg: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            counts: true,
            warnings: true,
            createdSites: true,
            errorMessage: true,
          },
        },
      },
    }),
    db.syncLeg.findFirst({
      where: { status: "COMMITTED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  return buildStatusView(batch, lastCommitted?.finishedAt ?? null, now);
}
