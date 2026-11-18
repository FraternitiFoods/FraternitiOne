"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCwIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { LegView, SyncStatusView } from "@/lib/sync-batch/view";

/** Dispatched on `window` after a sync that changed data: client-driven pages (Site Tracker) refetch on it. */
export const SYNC_DONE_EVENT = "fone:sync-done";

const POLL_MS = 2500;

const LEG_LABEL: Record<LegView["leg"], string> = {
  STAGES: "Stages",
  SITE_BOQ: "Site BOQ",
  OPS_BOQ: "Ops BOQ",
};

type Counts = Record<string, number | undefined>;

/** "3 updated" / "no changes" for a finished leg — the numbers are the units actually rewritten. */
function doneDetail(leg: LegView): string {
  const c = (leg.counts ?? {}) as Counts;
  const changed = leg.leg === "STAGES" ? c.sites : leg.leg === "SITE_BOQ" ? c.categories : c.changedTabs;
  const unit = leg.leg === "STAGES" ? "site" : "tab";
  if (!changed) return "no changes";
  return `${changed} ${unit}${changed === 1 ? "" : "s"} updated`;
}

/**
 * The unified "Sync" button (Dashboard, Site Tracker, Site BOQ, Operations
 * BOQ): one press refreshes all four pages from the three sheets. Admin only —
 * the server wrapper doesn't render it for anyone else.
 *
 * Design for "no lag": POST /api/sync/run answers in ~150 ms and the button
 * flips to "Syncing…" at once; the only network after that is ONE self-
 * rescheduling poll of GET /api/sync/status, and only while a batch is active
 * (no mount fetch — the server seeds `initial` — and no idle polling). When it
 * observes a batch finish, it refreshes the page data once.
 */
export function UnifiedSyncButton({ initial }: { initial: SyncStatusView }) {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatusView>(initial);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True only for a batch THIS mounted component watched finish — a fresh page
  // load that merely finds an old finished batch shows "Last synced…" instead.
  const [justFinished, setJustFinished] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const wasActiveRef = useRef(initial.active);
  const pollLoopRef = useRef<() => void>(() => {});

  const onFinished = useCallback(
    (data: SyncStatusView) => {
      setJustFinished(true);
      const anyCommitted = data.legs.some((l) => l.state === "done");
      const created = data.legs.flatMap((l) => l.createdSites);
      if (created.length > 0) {
        toast.info(`Sync created ${created.length} new site${created.length === 1 ? "" : "s"}: ${created.join(", ")}`, {
          description: "If a name is just a different spelling of an existing site, tell an admin to add an alias.",
          duration: 12_000,
        });
      }
      const failed = data.legs.filter((l) => l.state === "failed");
      if (failed.length === 0) toast.success("Sync finished — data refreshed.");
      else toast.error(`Sync finished with ${failed.length} problem${failed.length === 1 ? "" : "s"}.`);
      if (anyCommitted) {
        router.refresh();
        window.dispatchEvent(new CustomEvent(SYNC_DONE_EVENT));
      }
    },
    [router]
  );

  const poll = useCallback(async (): Promise<SyncStatusView | undefined> => {
    try {
      const res = await fetch("/api/sync/status", { cache: "no-store" });
      if (!res.ok) return undefined;
      const data = (await res.json()) as SyncStatusView;
      if (!mountedRef.current) return data;
      setStatus(data);
      if (wasActiveRef.current && !data.active) onFinished(data);
      wasActiveRef.current = data.active;
      return data;
    } catch {
      return undefined;
    }
  }, [onFinished]);

  // One self-rescheduling loop (same shape as the retired per-sheet buttons):
  // the mount effect (a page load mid-sync) and a click both call it, and it
  // keeps going only while a batch is active. Called through a ref so it never
  // closes over a stale `poll`.
  const pollLoop = useCallback(async () => {
    const data = await poll();
    if (!mountedRef.current) return;
    if (data?.active) timerRef.current = setTimeout(() => pollLoopRef.current(), POLL_MS);
  }, [poll]);

  useEffect(() => {
    pollLoopRef.current = pollLoop;
  }, [pollLoop]);

  useEffect(() => {
    mountedRef.current = true;
    if (initial.active) pollLoopRef.current();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: `initial` seeds state, it is not a live input
  }, []);

  async function start(legs?: LegView["leg"][]) {
    setRequesting(true);
    setError(null);
    setJustFinished(false);
    try {
      const res = await fetch("/api/sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legs ? { legs } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start the sync.");
        return;
      }
      // Optimistic: the batch exists now, so show it running before the first poll lands.
      wasActiveRef.current = true;
      setStatus((prev) => ({
        ...prev,
        batchId: data.batchId,
        active: true,
        legs: (data.legs as { leg: LegView["leg"] }[]).map((l) => ({
          leg: l.leg,
          state: "running" as const,
          counts: null,
          createdSites: [],
          warningCount: 0,
          error: null,
        })),
      }));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => pollLoopRef.current(), 800);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRequesting(false);
    }
  }

  const busy = status.active || requesting;
  const showChips = status.legs.length > 0 && (status.active || justFinished || status.legs.some((l) => l.state === "failed"));

  return (
    <div className="flex flex-col items-end gap-1" data-testid="unified-sync">
      <Button
        size="sm"
        variant="outline"
        onClick={() => start()}
        disabled={busy}
        aria-busy={busy}
        data-testid="unified-sync-button"
      >
        <RefreshCwIcon className={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
        {busy ? "Syncing…" : "Sync"}
      </Button>

      {/* Fixed-height status line: chips appear without pushing the page content down. */}
      <div className="flex min-h-5 flex-wrap items-center justify-end gap-1.5 text-xs" aria-live="polite">
        {showChips ? (
          status.legs.map((leg) => (
            <span
              key={leg.leg}
              data-testid={`sync-chip-${leg.leg}`}
              data-state={leg.state}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                leg.state === "failed" && "border-destructive/40 text-destructive",
                leg.state === "done" && "text-foreground",
                leg.state === "running" && "text-muted-foreground"
              )}
              title={leg.error ?? undefined}
            >
              {LEG_LABEL[leg.leg]}:{" "}
              {leg.state === "running" ? "syncing…" : leg.state === "done" ? doneDetail(leg) : "failed"}
              {leg.state === "failed" && !busy && (
                <button
                  type="button"
                  className="ml-1 underline underline-offset-2"
                  onClick={() => start([leg.leg])}
                  data-testid={`sync-retry-${leg.leg}`}
                >
                  Retry
                </button>
              )}
            </span>
          ))
        ) : status.lastCommittedAt ? (
          <span className="text-muted-foreground">Last synced: {formatDateTime(status.lastCommittedAt)}</span>
        ) : (
          <span className="text-muted-foreground">No sync has run yet.</span>
        )}
      </div>

      {status.legs.some((l) => l.state === "failed" && l.error) && !busy && (
        <p className="max-w-xs text-right text-xs text-destructive">
          {status.legs.find((l) => l.state === "failed" && l.error)?.error}
        </p>
      )}
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
