import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { DashboardSyncTrigger } from "./schema";

/**
 * Mirrors src/lib/sheet-sync/request-state.ts exactly, keyed under its own
 * AppSetting row so a Dashboard sync request/run can never collide with
 * Site BOQ's "sheetSyncRequest" singleton.
 */
const REQUEST_KEY = "dashboardSyncRequest";

export type RequestStatus = "idle" | "requested" | "picked_up" | "running" | "success" | "failed";

export type LastRunSummary = {
  trigger: DashboardSyncTrigger | null;
  sites: number;
  durationSec: number;
  error?: string;
};

export type RequestState = {
  status: RequestStatus;
  requestId: string | null;
  runId: string | null;
  trigger: DashboardSyncTrigger | null;
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

/** Atomic check-and-set via a row-locked AppSetting, same mechanism as sheet-sync's request-state.ts. */
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

/** POST /request: creates a request, or returns the already-in-flight one (no stacking). */
export async function claimRequest(trigger: DashboardSyncTrigger): Promise<{ requestId: string; created: boolean }> {
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

/** /start: the script is turning a picked-up request (or an unsolicited daily run) into an actual run. */
export async function markRunning(runId: string, trigger: DashboardSyncTrigger): Promise<RequestState> {
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
