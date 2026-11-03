import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { SyncTrigger } from "./schema";

const REQUEST_KEY = "sheetSyncRequest";

export type RequestStatus = "idle" | "requested" | "picked_up" | "running" | "success" | "failed";

export type LastRunSummary = {
  trigger: SyncTrigger | null;
  tabs: number;
  items: number;
  sites: number;
  durationSec: number;
  error?: string;
};

export type RequestState = {
  status: RequestStatus;
  requestId: string | null;
  runId: string | null;
  trigger: SyncTrigger | null;
  /** ISO timestamp of when `status` was last set — drives the "not picked up in 3 min" / reaper's "running > 10 min" timers. */
  createdAt: string | null;
  stuckAlertSent: boolean;
  lastRun: LastRunSummary | null;
};

const IDLE_STATE: RequestState = {
  status: "idle",
  requestId: null,
  runId: null,
  trigger: null,
  createdAt: null,
  stuckAlertSent: false,
  lastRun: null,
};

function parseState(value: unknown): RequestState {
  if (!value || typeof value !== "object") return IDLE_STATE;
  return { ...IDLE_STATE, ...(value as Partial<RequestState>) };
}

export async function getRequestState(): Promise<RequestState> {
  const row = await db.appSetting.findUnique({ where: { key: REQUEST_KEY } });
  return parseState(row?.value);
}

/**
 * Every write to the singleton goes through this: a single transaction that
 * row-locks (`SELECT ... FOR UPDATE`) the AppSetting row, lets `mutate`
 * decide the next state from the current one, and writes it back — all
 * inside one DB round trip's worth of lock scope. This is what makes
 * claimRequest below a real atomic check-and-set: a second concurrent call
 * blocks on the lock until the first transaction commits, then sees the
 * already-updated state instead of racing to create a second request.
 */
async function atomicUpdate(mutate: (current: RequestState) => RequestState): Promise<RequestState> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "AppSetting" (key, value, "updatedAt")
      VALUES (${REQUEST_KEY}, ${JSON.stringify(IDLE_STATE)}::jsonb, now())
      ON CONFLICT (key) DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ value: unknown }[]>`
      SELECT value FROM "AppSetting" WHERE key = ${REQUEST_KEY} FOR UPDATE
    `;
    const current = parseState(rows[0]?.value);
    const next = mutate(current);
    await tx.appSetting.update({ where: { key: REQUEST_KEY }, data: { value: next } });
    return next;
  });
}

/**
 * Handoff section 3's /request: "Creates a request, returns 202 {requestId}.
 * If one is already requested/picked_up/running, return that one, don't
 * stack." The FOR UPDATE lock in atomicUpdate is what makes 5 rapid clicks
 * (handoff's test 6) produce exactly one request.
 */
export async function claimRequest(trigger: SyncTrigger): Promise<{ requestId: string; created: boolean }> {
  let created = false;
  const result = await atomicUpdate((current) => {
    if (current.status === "requested" || current.status === "picked_up" || current.status === "running") {
      return current;
    }
    created = true;
    return {
      status: "requested",
      requestId: randomUUID(),
      runId: null,
      trigger,
      createdAt: new Date().toISOString(),
      stuckAlertSent: false,
      lastRun: current.lastRun,
    };
  });
  return { requestId: result.requestId!, created };
}

/** /pending: a request exists, isn't picked up yet, and no run is currently running. */
export async function markPickedUp(): Promise<RequestState> {
  return atomicUpdate((current) => {
    if (current.status !== "requested") return current;
    return { ...current, status: "picked_up" };
  });
}

/** /start: the script is turning a picked-up request (or an unsolicited daily/menu run) into an actual run. */
export async function markRunning(runId: string, trigger: SyncTrigger): Promise<RequestState> {
  return atomicUpdate((current) => ({
    status: "running",
    requestId: current.requestId,
    runId,
    trigger,
    createdAt: new Date().toISOString(),
    stuckAlertSent: false,
    lastRun: current.lastRun,
  }));
}

export async function markSuccess(summary: LastRunSummary): Promise<RequestState> {
  return atomicUpdate((current) => ({
    ...IDLE_STATE,
    status: "success",
    lastRun: summary,
    trigger: current.trigger,
  }));
}

export async function markFailed(summary: LastRunSummary): Promise<RequestState> {
  return atomicUpdate((current) => ({
    ...IDLE_STATE,
    status: "failed",
    lastRun: summary,
    trigger: current.trigger,
  }));
}

/** Reaper/stuck-alert bookkeeping: flips stuckAlertSent without changing status, so the alert fires once. */
export async function markStuckAlertSent(): Promise<void> {
  await atomicUpdate((current) => ({ ...current, stuckAlertSent: true }));
}

/** Is there a request/run in flight right now (used by /request's mode-gated rejection message and /status)? */
export function isActive(state: RequestState): boolean {
  return state.status === "requested" || state.status === "picked_up" || state.status === "running";
}
