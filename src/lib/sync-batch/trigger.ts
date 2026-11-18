import "server-only";

import type { PrismaClient, SyncLegKind } from "@prisma/client";
import { failLeg } from "./legs";

/**
 * Website -> Apps Script Web App ("kick"). Each leg's script is deployed as a
 * Web App; the website POSTs {secret, batchId, leg, force} to its /exec URL.
 * doPost cannot read headers, so the secret rides in the JSON body (the
 * script -> website callbacks keep using `Authorization: Bearer`). The
 * website never sends a callback URL: the script has WEBSITE_BASE_URL in its
 * own Script Properties, so a leaked secret can't redirect data elsewhere.
 *
 * doPost runs the whole extraction synchronously and answers when done, so the
 * fetch below is held open (inside next/server `after()`, maxDuration 300).
 * Leg STATE is driven only by the script's callbacks (start/chunk/finish/fail);
 * the kick response is used for early failure detection and as a safety net.
 *
 * Nothing here ever logs or returns the /exec URL or the secret.
 */

export const KICK_TIMEOUT_MS = 290_000;

const LEG_ENV: Record<SyncLegKind, { url: string; secret: string; label: string }> = {
  STAGES: { url: "SYNC_STAGES_WEBAPP_URL", secret: "DASHBOARD_SYNC_SECRET", label: "Site stages sheet" },
  SITE_BOQ: { url: "SYNC_SITE_BOQ_WEBAPP_URL", secret: "SHEET_SYNC_SECRET", label: "Site BOQ sheet" },
  OPS_BOQ: { url: "SYNC_OPS_BOQ_WEBAPP_URL", secret: "OPS_BOQ_SYNC_SECRET", label: "Ops BOQ sheet" },
};

export function legLabel(leg: SyncLegKind): string {
  return LEG_ENV[leg].label;
}

/** Names (never values) of the env vars missing for the requested legs. */
export function missingConfig(legs: readonly SyncLegKind[], env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  for (const leg of legs) {
    const cfg = LEG_ENV[leg];
    if (!env[cfg.url]) missing.push(cfg.url);
    if (!env[cfg.secret]) missing.push(cfg.secret);
  }
  return missing;
}

export type KickOutcome = { kind: "ok" } | { kind: "busy" } | { kind: "error"; message: string };

/**
 * Pure: what did the web app's HTTP answer mean? A non-JSON body is almost
 * always Google's login / "Authorization needed" HTML page (web app not
 * deployed, not authorised, or access not "Anyone").
 */
export function classifyKickResponse(status: number, bodyText: string): KickOutcome {
  if (status < 200 || status >= 300) {
    return { kind: "error", message: `The sheet's web app answered HTTP ${status}.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      kind: "error",
      message: "The sheet's web app didn't answer with JSON — it may not be deployed or authorised yet.",
    };
  }
  if (parsed && typeof parsed === "object") {
    const p = parsed as { ok?: unknown; busy?: unknown; error?: unknown };
    if (p.busy === true) return { kind: "busy" };
    if (p.ok === false) {
      const detail = typeof p.error === "string" ? p.error.slice(0, 200) : "unknown error";
      return { kind: "error", message: `The sheet reported an error: ${detail}` };
    }
    if (p.ok === true) return { kind: "ok" };
  }
  return { kind: "error", message: "The sheet's web app gave an unexpected answer." };
}

type KickDb = Pick<PrismaClient, "syncLeg" | "syncBatch" | "$executeRaw">;

/** Kick one leg. Never throws. Marks the leg FAILED on any early/obvious failure. */
export async function kickLeg(
  db: KickDb,
  batchId: string,
  leg: SyncLegKind,
  force: boolean,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const cfg = LEG_ENV[leg];
  const url = process.env[cfg.url];
  const secret = process.env[cfg.secret];
  if (!url || !secret) {
    await failLeg(db, batchId, leg, `${cfg.label} isn't configured on the server.`);
    return;
  }

  let outcome: KickOutcome;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, batchId, leg, force }),
      redirect: "follow",
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    outcome = classifyKickResponse(res.status, await res.text());
  } catch (err) {
    // A timeout/abort is NOT a failure: Apps Script may still be running and
    // its callbacks drive the leg. Anything else = couldn't reach it at all.
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") return;
    console.error(`Unified sync: could not reach ${leg} web app (${name || "error"}).`);
    await failLeg(db, batchId, leg, `Couldn't reach the ${cfg.label}'s web app.`);
    return;
  }

  if (outcome.kind === "busy") {
    await failLeg(db, batchId, leg, `The ${cfg.label} is already syncing — try again in a minute.`);
  } else if (outcome.kind === "error") {
    await failLeg(db, batchId, leg, outcome.message);
  } else {
    // Script says it finished OK. If its callbacks never completed the leg, it
    // would sit RUNNING until timeout — close it now instead.
    await failLegIfStillRunning(db, batchId, leg);
  }
}

async function failLegIfStillRunning(db: KickDb, batchId: string, leg: SyncLegKind): Promise<void> {
  const row = await db.syncLeg.findFirst({ where: { batchId, leg, status: "RUNNING" }, select: { id: true } });
  if (row) await failLeg(db, batchId, leg, `The ${LEG_ENV[leg].label} finished without reporting a result.`);
}

/** Fan out to every requested leg in parallel; each handles its own errors. */
export async function kickLegs(
  db: KickDb,
  batchId: string,
  legs: readonly SyncLegKind[],
  force: boolean
): Promise<void> {
  await Promise.allSettled(legs.map((leg) => kickLeg(db, batchId, leg, force)));
}
