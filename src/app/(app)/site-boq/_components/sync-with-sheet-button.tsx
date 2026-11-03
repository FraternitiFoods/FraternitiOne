"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { StatusResponse } from "@/lib/sheet-sync/run";

const POLL_MS = 4000;

const TRIGGER_LABEL: Record<string, string> = {
  button: "by button",
  daily: "daily auto-sync",
  menu: "sheet menu",
};

/**
 * docs/sheet-sync/CLAUDE_CODE_HANDOFF.md section 6: "Sync with sheet" button
 * + status label, Admin only. Polls GET /api/sheet-sync/status every few
 * seconds only while a request/run is active (handoff: "stop otherwise"),
 * and on mount so a page load mid-sync (triggered by daily/menu/another
 * admin) shows the live state immediately instead of a stale "idle".
 */
export function SyncWithSheetButton() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "success" is a server-persisted state (survives until the next request),
  // but handoff section 6 only wants "Done — N items, N sites" shown to
  // whoever was actually watching the sync happen — a plain page load later
  // should show "Last synced: ..." instead, same as idle. justFinished is
  // true only when THIS mounted component itself observed the transition
  // into "success", not on a fresh mount that happens to find a stale
  // "success" from someone else's earlier run.
  const [justFinished, setJustFinished] = useState(false);
  const prevStateRef = useRef<StatusResponse["state"] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pollLoopRef = useRef<() => void>(() => {});

  const poll = useCallback(async (): Promise<StatusResponse | undefined> => {
    try {
      const res = await fetch("/api/sheet-sync/status", { cache: "no-store" });
      if (!res.ok) return undefined;
      const data = (await res.json()) as StatusResponse;
      const wasActive = prevStateRef.current === "waiting_for_sheet" || prevStateRef.current === "syncing";
      if (wasActive && data.state === "success") setJustFinished(true);
      else if (data.state !== "success") setJustFinished(false);
      prevStateRef.current = data.state;
      setStatus(data);
      return data;
    } catch {
      return undefined;
    }
  }, []);

  // One self-rescheduling loop (not a fire-and-forget single timeout) — both
  // the mount effect and handleClick call this same function, so a click
  // restarts it, a stale sync caught on page load continues it, and it
  // genuinely keeps polling every POLL_MS until the state is no longer
  // active, not just once or twice. Scheduled through a ref (not by naming
  // itself inside its own body) so it isn't a stale closure if `poll` ever
  // changed identity.
  const pollLoop = useCallback(async () => {
    const data = await poll();
    if (!mountedRef.current) return;
    const stillActive = data?.state === "waiting_for_sheet" || data?.state === "syncing";
    if (stillActive) {
      timerRef.current = setTimeout(() => pollLoopRef.current(), POLL_MS);
    }
  }, [poll]);

  useEffect(() => {
    pollLoopRef.current = pollLoop;
  }, [pollLoop]);

  useEffect(() => {
    mountedRef.current = true;
    pollLoopRef.current();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleClick() {
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch("/api/sheet-sync/request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start a sync.");
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      pollLoop();
    } finally {
      setRequesting(false);
    }
  }

  if (!status) return null;

  const lastSyncedLine = status.lastSyncedAt ? (
    <p className="text-xs text-muted-foreground">
      Last synced: {formatDateTime(status.lastSyncedAt)}
      {status.lastRun?.trigger ? ` (${TRIGGER_LABEL[status.lastRun.trigger] ?? status.lastRun.trigger})` : ""}
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">No sync has run yet.</p>
  );

  const busy = status.state === "waiting_for_sheet" || status.state === "syncing" || requesting;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={busy}>
        {status.state === "waiting_for_sheet"
          ? "Waiting for the sheet…"
          : status.state === "syncing"
            ? "Syncing…"
            : "Sync with sheet"}
      </Button>

      {status.state === "waiting_for_sheet" && (
        <p className="text-xs text-muted-foreground">Waiting for the sheet… (up to a minute)</p>
      )}
      {status.state === "syncing" && <p className="text-xs text-muted-foreground">Syncing… (1–2 min)</p>}
      {status.state === "success" && justFinished && status.lastRun && (
        <p className="text-xs text-muted-foreground">
          Done — {status.lastRun.items} items, {status.lastRun.sites} sites
        </p>
      )}
      {status.state === "failed" && status.lastRun?.error && (
        <p className="text-xs text-destructive">{status.lastRun.error}</p>
      )}
      {(status.state === "idle" || (status.state === "success" && !justFinished)) && lastSyncedLine}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
