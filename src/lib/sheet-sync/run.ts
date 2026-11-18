import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { sendSheetSyncFailureEmail } from "@/lib/email";
import { loadStoredHashes, splitChanged, stampHash } from "@/lib/sync-batch/hash";
import { attachRun, completeLeg, failLeg, findBatchForRun } from "@/lib/sync-batch/legs";
import { SyncError } from "./errors";
import { commitRun } from "./commit";
import {
  claimRequest,
  getRequestState,
  markFailed,
  markPickedUp,
  markRunning,
  markStuckAlertSent,
  markSuccess,
} from "./request-state";
import type { ChunkBody, FailBody, FinishBody, StartBody, SyncTrigger } from "./schema";

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const STUCK_REQUEST_MS = 3 * 60 * 1000;

type Counts = { categories?: number; items?: number; sites?: number };

export async function getLastSyncedAt(): Promise<Date | null> {
  const run = await db.importRun.findFirst({
    where: { trigger: { not: null }, status: "COMMITTED" },
    orderBy: { finishedAt: "desc" },
  });
  return run?.finishedAt ?? null;
}

async function notifyFailure(trigger: string | null, message: string): Promise<void> {
  const to = process.env.SHEET_SYNC_ALERT_EMAIL;
  if (!to) {
    console.error("SHEET_SYNC_ALERT_EMAIL is not set — skipping sheet sync failure email:", message);
    return;
  }
  try {
    await sendSheetSyncFailureEmail({ to, trigger: trigger ?? "button", errorMessage: message, lastSyncedAt: await getLastSyncedAt() });
  } catch (err) {
    console.error("Failed to send sheet sync failure email:", err);
  }
}

/**
 * Shared by /api/sheet-sync/fail and every internal failure path (finish
 * validation, mode flipped mid-run, the reaper). Idempotent — if the run is
 * already resolved (a retried /fail, or the reaper racing a real /fail),
 * this is a no-op rather than double-sending the alert email.
 */
async function failRunInternal(runId: string, message: string): Promise<void> {
  const run = await db.importRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "IN_PROGRESS") return;

  await db.$transaction(async (tx) => {
    await tx.boqSyncStagingChunk.deleteMany({ where: { runId } });
    await tx.importRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message } });
  });

  const durationSec = Math.round((Date.now() - run.startedAt.getTime()) / 1000);
  await markFailed({ trigger: (run.trigger as SyncTrigger) ?? null, tabs: 0, items: 0, sites: 0, durationSec, error: message });

  // Unified sync: the leg shows the failure (and offers Retry) in the UI.
  const batchId = await findBatchForRun(db, "SITE_BOQ", runId);
  if (batchId) await failLeg(db, batchId, "SITE_BOQ", message);

  await notifyFailure(run.trigger, message);
}

/** Handoff section 6's reaper: "any run `running` for more than 10 min => mark failed, delete staging, send alert." Called lazily from /pending and /status — no cron. */
export async function reapStaleRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_TIMEOUT_MS);
  const stale = await db.importRun.findMany({
    where: { status: "IN_PROGRESS", trigger: { not: null }, startedAt: { lt: cutoff } },
  });
  for (const run of stale) {
    await failRunInternal(run.id, "Timed out (running for more than 10 minutes).");
  }
}

/** Handoff section 6: "If a request is not picked up within 3 minutes ... send the alert email once." Does not change state — the button stays in "waiting for the sheet" until picked up or the reaper eventually clears it via a later run. */
export async function checkStuckRequestAlert(): Promise<void> {
  const state = await getRequestState();
  if (state.status !== "requested" || !state.createdAt || state.stuckAlertSent) return;
  if (Date.now() - new Date(state.createdAt).getTime() < STUCK_REQUEST_MS) return;

  await markStuckAlertSent();
  await notifyFailure(state.trigger, "Sheet did not respond. Its auto-trigger may be off — ask Abhishek.");
}

/**
 * POST /api/sheet-sync/request (admin session, see route file) — retired (the
 * route answers 410). Kept so the old request-state plumbing still type-checks;
 * the unified Sync button uses /api/sync/run instead.
 */
export async function requestSync(): Promise<{ requestId: string; created: boolean }> {
  return claimRequest("button");
}

/** GET /api/sheet-sync/pending — the old poll model; nothing queues a request any more (/request is 410), so this is {pending:false} in practice. */
export async function checkPending(): Promise<{ pending: boolean; requestId?: string; trigger?: SyncTrigger }> {
  await reapStaleRuns();

  await checkStuckRequestAlert();

  const state = await getRequestState();
  if (state.status !== "requested") return { pending: false };

  const running = await db.importRun.findFirst({ where: { status: "IN_PROGRESS", trigger: { not: null } } });
  if (running) return { pending: false };

  await markPickedUp();
  return { pending: true, requestId: state.requestId ?? undefined, trigger: state.trigger ?? undefined };
}

/** Unit key under which the website-locked-sites fingerprint is stored (see planTabs). */
const LOCKED_CTX_KEY = "__locked";

/**
 * Unified sync: compare the script's per-tab hashes with the stored ones.
 *
 * Besides each tab's own hash there is one piece of server-side context that
 * changes what a tab's commit does without changing the tab itself: which
 * sites are website-locked (a locked site's qty/tracking is skipped by the
 * commit). If that set changed since the last sync, every tab is re-synced —
 * otherwise a site unlocked on the website would stay stale until its tab
 * happened to change in the sheet.
 */
async function planTabs(
  manifest: NonNullable<StartBody["tabManifest"]>,
  batchId: string | undefined
): Promise<{ changed: string[]; stored: { tabs: { category: string; hash: string }[]; ctx: string; ctxChanged: boolean } }> {
  const byCategory = new Map<string, string>();
  for (const m of manifest) if (!byCategory.has(m.category)) byCategory.set(m.category, m.hash);
  const entries = [...byCategory].map(([category, hash]) => ({ category, hash }));

  const lockedRows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Site" WHERE "isLocked" = true ORDER BY "id"`;
  const ctx = createHash("sha256").update(lockedRows.map((r) => r.id).join(",")).digest("hex");

  const [stored, batch] = await Promise.all([
    loadStoredHashes(db, "SITE_BOQ", [...byCategory.keys(), LOCKED_CTX_KEY]),
    batchId ? db.syncBatch.findUnique({ where: { id: batchId }, select: { force: true } }) : null,
  ]);
  const ctxChanged = stored.get(LOCKED_CTX_KEY) !== stampHash(ctx);

  const { changed } = splitChanged(
    entries.map((e) => ({ key: e.category, hash: e.hash })),
    stored,
    { force: batch?.force === true || ctxChanged }
  );
  return { changed, stored: { tabs: entries, ctx, ctxChanged } };
}

/** POST /api/sheet-sync/start. */
export async function startRun(body: StartBody): Promise<{ runId: string; changed?: string[] }> {
  await reapStaleRuns();

  const activeRun = await db.importRun.findFirst({
    where: { status: "IN_PROGRESS", trigger: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  if (activeRun && Date.now() - activeRun.startedAt.getTime() < RUN_TIMEOUT_MS) {
    throw new SyncError(409, `Another sync run ("${activeRun.id}") is already in progress.`);
  }

  const plan = body.tabManifest ? await planTabs(body.tabManifest, body.batchId) : null;

  const run = await db.importRun.create({
    data: {
      status: "IN_PROGRESS",
      trigger: body.trigger,
      requestId: body.requestId,
      sitesPayload: { sites: body.sites, lockedSites: body.lockedSites },
      tabManifest: plan ? (plan.stored as unknown as object) : undefined,
      warnings: [],
    },
  });

  if (body.batchId) await attachRun(db, body.batchId, "SITE_BOQ", run.id);
  await markRunning(run.id, body.trigger);
  return plan ? { runId: run.id, changed: plan.changed } : { runId: run.id };
}

/** POST /api/sheet-sync/chunk. Idempotent by (runId, category) — a retried chunk upsert replaces, never duplicates. */
export async function storeChunk(body: ChunkBody): Promise<{ warnings: string[] }> {
  const run = await db.importRun.findUnique({ where: { id: body.runId } });
  if (!run) throw new SyncError(404, `Unknown runId "${body.runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new SyncError(400, `Run "${body.runId}" is not in progress (status: ${run.status}).`);
  }

  await db.boqSyncStagingChunk.upsert({
    where: { runId_category: { runId: body.runId, category: body.tab.category } },
    update: { payload: body.tab },
    create: { runId: body.runId, category: body.tab.category, payload: body.tab },
  });

  return { warnings: [] };
}

/**
 * POST /api/sheet-sync/finish. The old SHEET_LIVE/WEBSITE_LIVE mode gate is
 * gone (owner decision 7): instead the commit itself only ever touches
 * sheet-origin data (see src/lib/sheet-sync/commit.ts — WEB- sites and items
 * are never adopted, overwritten, deleted or deactivated).
 */
export async function finishRun(body: FinishBody) {
  const run = await db.importRun.findUnique({ where: { id: body.runId } });
  if (!run) throw new SyncError(404, `Unknown runId "${body.runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new SyncError(400, `Run "${body.runId}" is not in progress (status: ${run.status}).`);
  }

  let result: Awaited<ReturnType<typeof commitRun>>;
  try {
    result = await commitRun(body.runId, body.expected);
  } catch (err) {
    const message = err instanceof SyncError ? err.message : "Unexpected error while committing the sync.";
    await failRunInternal(body.runId, message);
    throw err instanceof SyncError ? err : new SyncError(500, message);
  }

  await db.$transaction(async (tx) => {
    await tx.boqSyncStagingChunk.deleteMany({ where: { runId: body.runId } });
    await tx.importRun.update({
      where: { id: body.runId },
      data: { status: "COMMITTED", finishedAt: new Date(), counts: result.counts, warnings: result.warnings },
    });
  });

  const durationSec = Math.round((Date.now() - run.startedAt.getTime()) / 1000);
  await markSuccess({
    trigger: (run.trigger as SyncTrigger) ?? null,
    tabs: result.counts.categories,
    items: result.counts.items,
    sites: result.counts.sites,
    durationSec,
  });

  const batchId = await findBatchForRun(db, "SITE_BOQ", body.runId);
  if (batchId) {
    await completeLeg(db, batchId, "SITE_BOQ", {
      counts: result.counts,
      warnings: result.warnings,
      createdSites: result.createdSites,
    });
  }

  return { runId: body.runId, ...result };
}

/** POST /api/sheet-sync/fail — the script reporting its own failure (e.g. it crashed mid-push). Not mode-gated: cleaning up a run never writes live BOQ data either way. */
export async function failRun(body: FailBody): Promise<void> {
  await failRunInternal(body.runId, body.message);
}

export type StatusResponse = {
  state: "idle" | "waiting_for_sheet" | "syncing" | "success" | "failed";
  lastSyncedAt: string | null;
  lastRun: { trigger: string | null; tabs: number; items: number; sites: number; durationSec: number; error?: string } | null;
};

/** GET /api/sheet-sync/status (admin session) — also drives the reaper/stuck-alert lazily, same as /pending. */
export async function getStatus(): Promise<StatusResponse> {
  await reapStaleRuns();
  await checkStuckRequestAlert();

  const state = await getRequestState();
  const uiState: StatusResponse["state"] =
    state.status === "requested" || state.status === "picked_up"
      ? "waiting_for_sheet"
      : state.status === "running"
        ? "syncing"
        : state.status === "success"
          ? "success"
          : state.status === "failed"
            ? "failed"
            : "idle";

  const lastCommitted = await db.importRun.findFirst({
    where: { trigger: { not: null }, status: "COMMITTED" },
    orderBy: { finishedAt: "desc" },
  });

  const lastRun =
    state.lastRun ??
    (lastCommitted
      ? {
          trigger: lastCommitted.trigger,
          tabs: (lastCommitted.counts as Counts | null)?.categories ?? 0,
          items: (lastCommitted.counts as Counts | null)?.items ?? 0,
          sites: (lastCommitted.counts as Counts | null)?.sites ?? 0,
          durationSec:
            lastCommitted.finishedAt && lastCommitted.startedAt
              ? Math.round((lastCommitted.finishedAt.getTime() - lastCommitted.startedAt.getTime()) / 1000)
              : 0,
        }
      : null);

  return {
    state: uiState,
    lastSyncedAt: lastCommitted?.finishedAt?.toISOString() ?? null,
    lastRun,
  };
}
