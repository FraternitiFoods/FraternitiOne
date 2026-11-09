"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { StatusResponse } from "@/lib/dashboard-sync/run";

const POLL_MS = 4000;

const TRIGGER_LABEL: Record<string, string> = {
  button: "by button",
  daily: "daily auto-sync",
};

/**
 * "Sync with sheet" button for the Dashboard home page (dashboard-sheet-sync-plan.md
 * section 6). Mirrors site-boq's SyncWithSheetButton exactly, pointed at
 * /api/dashboard-sync/* instead — same poll-while-active pattern.
 */
export function DashboardSyncButton() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const prevStateRef = useRef<StatusResponse["state"] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pollLoopRef = useRef<() => void>(() => {});

  const poll = useCallback(async (): Promise<StatusResponse | undefined> => {
    try {
      const res = await fetch("/api/dashboard-sync/status", { cache: "no-store" });
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
      const res = await fetch("/api/dashboard-sync/request", { method: "POST" });
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
        <p className="text-xs text-muted-foreground">Done — {status.lastRun.sites} sites</p>
      )}
      {status.state === "failed" && status.lastRun?.error && (
        <p className="text-xs text-destructive">{status.lastRun.error}</p>
      )}
      {(status.state === "idle" || (status.state === "success" && !justFinished)) && lastSyncedLine}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
