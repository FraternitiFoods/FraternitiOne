import "server-only";

import { db } from "@/lib/db";
import { getImportMode } from "@/lib/app-settings";
import { sendSheetSyncFailureEmail } from "@/lib/email";
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
 * POST /api/sheet-sync/request (admin session, see route file) — user's
 * condition 1: only usable in SHEET_LIVE mode, clear rejection message
 * otherwise.
 */
export async function requestSync(): Promise<{ requestId: string; created: boolean }> {
  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") {
    throw new SyncError(403, "Sheet sync is disabled: Site BOQ is in WEBSITE_LIVE mode.");
  }
  return claimRequest("button");
}

/**
 * GET /api/sheet-sync/pending — user's condition 1: WEBSITE_LIVE mode
 * returns {pending:false} (not 403), so the script's once-a-minute poll
 * degrades quietly instead of erroring.
 */
export async function checkPending(): Promise<{ pending: boolean; requestId?: string; trigger?: SyncTrigger }> {
  await reapStaleRuns();

  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") return { pending: false };

  await checkStuckRequestAlert();

  const state = await getRequestState();
  if (state.status !== "requested") return { pending: false };

  const running = await db.importRun.findFirst({ where: { status: "IN_PROGRESS", trigger: { not: null } } });
  if (running) return { pending: false };

  await markPickedUp();
  return { pending: true, requestId: state.requestId ?? undefined, trigger: state.trigger ?? undefined };
}

/** POST /api/sheet-sync/start. Mode-gated like the old importer (403) — user's condition 1 only special-cases /pending and /request. */
export async function startRun(body: StartBody): Promise<{ runId: string }> {
  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") {
    throw new SyncError(403, "Sheet sync is disabled: Site BOQ is in WEBSITE_LIVE mode.");
  }

  await reapStaleRuns();

  const activeRun = await db.importRun.findFirst({
    where: { status: "IN_PROGRESS", trigger: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  if (activeRun && Date.now() - activeRun.startedAt.getTime() < RUN_TIMEOUT_MS) {
    throw new SyncError(409, `Another sync run ("${activeRun.id}") is already in progress.`);
  }

  const run = await db.importRun.create({
    data: {
      status: "IN_PROGRESS",
      trigger: body.trigger,
      requestId: body.requestId,
      sitesPayload: { sites: body.sites, lockedSites: body.lockedSites },
      warnings: [],
    },
  });

  await markRunning(run.id, body.trigger);
  return { runId: run.id };
}

/** POST /api/sheet-sync/chunk. Idempotent by (runId, category) — a retried chunk upsert replaces, never duplicates. */
export async function storeChunk(body: ChunkBody): Promise<{ warnings: string[] }> {
  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") {
    throw new SyncError(403, "Sheet sync is disabled: Site BOQ is in WEBSITE_LIVE mode.");
  }

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
 * POST /api/sheet-sync/finish — user's condition 1: mode is re-checked here
 * too (not just at /start), since the script's whole push can take minutes
 * and an Admin could flip the switch mid-run. If so, the run fails exactly
 * like any other validation failure: nothing commits, live data stays
 * untouched, the alert email goes out.
 */
export async function finishRun(body: FinishBody) {
  const run = await db.importRun.findUnique({ where: { id: body.runId } });
  if (!run) throw new SyncError(404, `Unknown runId "${body.runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new SyncError(400, `Run "${body.runId}" is not in progress (status: ${run.status}).`);
  }

  const mode = await getImportMode();
  if (mode === "WEBSITE_LIVE") {
    const message = "Site BOQ mode changed to WEBSITE_LIVE during the sync — aborted, live data untouched.";
    await failRunInternal(body.runId, message);
    throw new SyncError(403, message);
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
