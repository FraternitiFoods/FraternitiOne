import "server-only";

import { db } from "@/lib/db";
import { sendDashboardSyncFailureEmail } from "@/lib/email";
import { DashboardSyncError } from "./errors";
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
import type { ChunkBody, DashboardSyncTrigger, FailBody, FinishBody, StartBody } from "./schema";

/** Mirrors src/lib/sheet-sync/run.ts's timers exactly — same reasoning (dashboard-sheet-sync-plan.md section 6/0 of the handoff doc this was patterned from). */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const STUCK_REQUEST_MS = 3 * 60 * 1000;

export async function getLastSyncedAt(): Promise<Date | null> {
  const run = await db.dashboardSyncRun.findFirst({ where: { status: "COMMITTED" }, orderBy: { finishedAt: "desc" } });
  return run?.finishedAt ?? null;
}

async function notifyFailure(trigger: string | null, message: string): Promise<void> {
  const to = process.env.DASHBOARD_SYNC_ALERT_EMAIL;
  if (!to) {
    console.error("DASHBOARD_SYNC_ALERT_EMAIL is not set — skipping dashboard sync failure email:", message);
    return;
  }
  try {
    await sendDashboardSyncFailureEmail({ to, trigger: trigger ?? "button", errorMessage: message, lastSyncedAt: await getLastSyncedAt() });
  } catch (err) {
    console.error("Failed to send dashboard sync failure email:", err);
  }
}

/** Shared by /fail and every internal failure path — idempotent, same as sheet-sync's failRunInternal. */
async function failRunInternal(runId: string, message: string): Promise<void> {
  const run = await db.dashboardSyncRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "IN_PROGRESS") return;

  await db.$transaction(async (tx) => {
    await tx.dashboardSyncStagingChunk.deleteMany({ where: { runId } });
    await tx.dashboardSyncRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message } });
  });

  const durationSec = Math.round((Date.now() - run.startedAt.getTime()) / 1000);
  await markFailed({ trigger: (run.trigger as DashboardSyncTrigger) ?? null, sites: 0, durationSec, error: message });
  await notifyFailure(run.trigger, message);
}

/** Any run `running` for more than 10 min is reaped — called lazily from /pending and /status, no cron. */
export async function reapStaleRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_TIMEOUT_MS);
  const stale = await db.dashboardSyncRun.findMany({ where: { status: "IN_PROGRESS", startedAt: { lt: cutoff } } });
  for (const run of stale) {
    await failRunInternal(run.id, "Timed out (running for more than 10 minutes).");
  }
}

/** If a request isn't picked up within 3 minutes, alert once. */
export async function checkStuckRequestAlert(): Promise<void> {
  const state = await getRequestState();
  if (state.status !== "requested" || !state.createdAt || state.stuckAlertSent) return;
  if (Date.now() - new Date(state.createdAt).getTime() < STUCK_REQUEST_MS) return;

  await markStuckAlertSent();
  await notifyFailure(state.trigger, "Sheet did not respond. Its auto-trigger may be off — ask Abhishek.");
}

/** POST /api/dashboard-sync/request (internal-role session, see route file) — no mode to gate on, unlike Site BOQ. */
export async function requestSync(): Promise<{ requestId: string; created: boolean }> {
  return claimRequest("button");
}

/** GET /api/dashboard-sync/pending. */
export async function checkPending(): Promise<{ pending: boolean; requestId?: string; trigger?: DashboardSyncTrigger }> {
  await reapStaleRuns();
  await checkStuckRequestAlert();

  const state = await getRequestState();
  if (state.status !== "requested") return { pending: false };

  const running = await db.dashboardSyncRun.findFirst({ where: { status: "IN_PROGRESS" } });
  if (running) return { pending: false };

  await markPickedUp();
  return { pending: true, requestId: state.requestId ?? undefined, trigger: state.trigger ?? undefined };
}

/** POST /api/dashboard-sync/start. */
export async function startRun(body: StartBody): Promise<{ runId: string }> {
  await reapStaleRuns();

  const activeRun = await db.dashboardSyncRun.findFirst({ where: { status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" } });
  if (activeRun && Date.now() - activeRun.startedAt.getTime() < RUN_TIMEOUT_MS) {
    throw new DashboardSyncError(409, `Another sync run ("${activeRun.id}") is already in progress.`);
  }

  const run = await db.dashboardSyncRun.create({
    data: {
      status: "IN_PROGRESS",
      trigger: body.trigger,
      requestId: body.requestId,
      deptLinksPayload: body.deptLinks as unknown as object,
      warnings: [],
    },
  });

  await markRunning(run.id, body.trigger);
  return { runId: run.id };
}

/** POST /api/dashboard-sync/chunk. Idempotent by (runId, siteName) — a retried chunk upsert replaces, never duplicates. */
export async function storeChunk(body: ChunkBody): Promise<{ warnings: string[] }> {
  const run = await db.dashboardSyncRun.findUnique({ where: { id: body.runId } });
  if (!run) throw new DashboardSyncError(404, `Unknown runId "${body.runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new DashboardSyncError(400, `Run "${body.runId}" is not in progress (status: ${run.status}).`);
  }

  await db.dashboardSyncStagingChunk.upsert({
    where: { runId_siteName: { runId: body.runId, siteName: body.site.name } },
    update: { payload: body.site as unknown as object },
    create: { runId: body.runId, siteName: body.site.name, payload: body.site as unknown as object },
  });

  return { warnings: [] };
}

/** POST /api/dashboard-sync/finish. */
export async function finishRun(body: FinishBody) {
  const run = await db.dashboardSyncRun.findUnique({ where: { id: body.runId } });
  if (!run) throw new DashboardSyncError(404, `Unknown runId "${body.runId}".`);
  if (run.status !== "IN_PROGRESS") {
    throw new DashboardSyncError(400, `Run "${body.runId}" is not in progress (status: ${run.status}).`);
  }

  let result: Awaited<ReturnType<typeof commitRun>>;
  try {
    result = await commitRun(body.runId, body.expected);
  } catch (err) {
    const message = err instanceof DashboardSyncError ? err.message : "Unexpected error while committing the sync.";
    await failRunInternal(body.runId, message);
    throw err instanceof DashboardSyncError ? err : new DashboardSyncError(500, message);
  }

  await db.$transaction(async (tx) => {
    await tx.dashboardSyncStagingChunk.deleteMany({ where: { runId: body.runId } });
    await tx.dashboardSyncRun.update({
      where: { id: body.runId },
      data: {
        status: "COMMITTED",
        finishedAt: new Date(),
        counts: result.counts,
        warnings: result.warnings,
        mismatches: result.mismatches as object,
      },
    });
  });

  const durationSec = Math.round((Date.now() - run.startedAt.getTime()) / 1000);
  await markSuccess({
    trigger: (run.trigger as DashboardSyncTrigger) ?? null,
    sites: result.counts.sites,
    durationSec,
  });

  return { runId: body.runId, ...result };
}

/** POST /api/dashboard-sync/fail — the script reporting its own failure. */
export async function failRun(body: FailBody): Promise<void> {
  await failRunInternal(body.runId, body.message);
}

export type StatusResponse = {
  state: "idle" | "waiting_for_sheet" | "syncing" | "success" | "failed";
  lastSyncedAt: string | null;
  lastRun: { trigger: string | null; sites: number; durationSec: number; error?: string } | null;
};

/** GET /api/dashboard-sync/status — also drives the reaper/stuck-alert lazily, same as /pending. */
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

  const lastCommitted = await db.dashboardSyncRun.findFirst({ where: { status: "COMMITTED" }, orderBy: { finishedAt: "desc" } });

  const lastRun =
    state.lastRun ??
    (lastCommitted
      ? {
          trigger: lastCommitted.trigger,
          sites: (lastCommitted.counts as { sites?: number } | null)?.sites ?? 0,
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
