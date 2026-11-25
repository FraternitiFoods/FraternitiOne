"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { SiteSelector } from "./site-selector";
import { SummaryCard } from "./summary-card";
import { FiltersBar, type StatusFilter } from "./filters-bar";
import { SectionAccordion } from "./section-accordion";
import { AllSitesTable } from "./all-sites-table";
import { findStep, applyStepUpdate, computeDefaultOpenSection } from "./tracker-client-utils";
import type { EvidenceItem, SiteProgressRow, SiteSummary, TrackerStatus } from "./types";

const LAST_SITE_KEY = "site-tracker:last-site-id";

function readLastSiteId(): string | null {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function writeLastSiteId(siteId: string) {
  try {
    window.localStorage.setItem(LAST_SITE_KEY, siteId);
  } catch {
    // localStorage can throw (private browsing, storage full) — losing the "remember last site" niceness isn't worth surfacing an error for.
  }
}

export function SiteTrackerApp({
  currentUserName,
  canEdit,
  isAdmin,
  initialSites,
  initialSummary,
}: {
  currentUserName: string;
  canEdit: boolean;
  isAdmin: boolean;
  initialSites: SiteProgressRow[];
  initialSummary: SiteSummary | null;
}) {
  const [tab, setTab] = useState<"tracker" | "all">("tracker");
  const [sites] = useState<SiteProgressRow[]>(initialSites);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(initialSites[0]?.site.id ?? null);
  const [summary, setSummary] = useState<SiteSummary | null>(initialSummary);
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    initialSummary ? computeDefaultOpenSection(initialSummary) : new Set()
  );
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);

  // The server render already seeded `summary` for this site — skip the next fetch for it once, so mounting doesn't immediately re-request data we already have.
  const skipInitialFetchRef = useRef(initialSummary ? (initialSites[0]?.site.id ?? null) : null);

  // localStorage is only readable client-side, so "switch to the last site the user looked at" has to happen post-mount, not during the server render.
  useEffect(() => {
    const remembered = readLastSiteId();
    if (remembered && remembered !== skipInitialFetchRef.current && sites.some((s) => s.site.id === remembered)) {
      setSelectedSiteId(remembered);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected site's full tracker whenever the selection changes (skipped once for the server-seeded default site).
  useEffect(() => {
    if (!selectedSiteId) return;
    if (skipInitialFetchRef.current === selectedSiteId) {
      skipInitialFetchRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSummary(true);
      try {
        const res = await fetch(`/api/tracker/sites/${selectedSiteId}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not load this site's tracker.");
        if (cancelled) return;
        const newSummary = body as SiteSummary;
        setSummary(newSummary);
        setOpenSectionIds(computeDefaultOpenSection(newSummary));
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Could not load this site's tracker.");
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId]);

  // "All sites" tab and the site selector both show the currently open site's live counts/progress rather than the possibly-stale numbers from the initial sites-list fetch — a derived value, not a second piece of state kept in sync via an effect.
  const displaySites = useMemo(() => {
    if (!sites) return [];
    if (!summary) return sites;
    return sites.map((row) =>
      row.site.id === summary.site.id
        ? { site: row.site, counts: summary.counts, progressPercent: summary.progressPercent }
        : row
    );
  }, [sites, summary]);

  function selectSite(siteId: string) {
    setSelectedSiteId(siteId);
    writeLastSiteId(siteId);
    setTab("tracker");
  }

  async function patchStep(
    stepId: string,
    patch: { status?: TrackerStatus; assignee?: string | null; remark?: string | null; notRequiredReason?: string | null }
  ): Promise<boolean> {
    if (!summary || !selectedSiteId) return false;
    const previousSummary = summary;
    const previousStep = findStep(summary, stepId);
    if (!previousStep) return false;

    const statusChanging = patch.status !== undefined && patch.status !== previousStep.status;
    const becomingCompleted = statusChanging && patch.status === "COMPLETED";
    const leavingCompleted = statusChanging && previousStep.status === "COMPLETED" && patch.status !== "COMPLETED";

    const optimisticStep = {
      ...previousStep,
      ...patch,
      completedAt: becomingCompleted
        ? new Date().toISOString()
        : leavingCompleted
          ? null
          : previousStep.completedAt,
      completedByName: becomingCompleted ? currentUserName : leavingCompleted ? null : previousStep.completedByName,
      updatedAt: new Date().toISOString(),
      updatedByName: currentUserName,
    };

    setSummary(applyStepUpdate(summary, stepId, optimisticStep));

    try {
      const res = await fetch("/api/tracker/site-steps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSiteId, stepId, ...patch }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save the change.");

      setSummary((current) => {
        if (!current) return current;
        return applyStepUpdate(current, stepId, {
          ...optimisticStep,
          status: body.status,
          assignee: body.assignee,
          remark: body.remark,
          notRequiredReason: body.notRequiredReason,
          completedAt: body.completedAt,
          legacyCompleted: body.legacyCompleted,
        });
      });
      return true;
    } catch (err) {
      setSummary(previousSummary);
      toast.error(err instanceof Error ? err.message : "Could not save the change.");
      return false;
    }
  }

  function handleEvidenceChange(stepId: string, evidence: EvidenceItem[]) {
    setSummary((current) => {
      if (!current) return current;
      const step = findStep(current, stepId);
      if (!step) return current;
      return applyStepUpdate(current, stepId, { ...step, evidence });
    });
  }

  const filteredSections = useMemo(() => {
    if (!summary) return [];
    const query = search.trim().toLowerCase();
    return summary.sections.map((section) => ({
      ...section,
      steps: section.steps.filter((step) => {
        if (statusFilter !== "ALL" && step.status !== statusFilter) return false;
        if (hideCompleted && step.status === "COMPLETED") return false;
        if (query && !step.name.toLowerCase().includes(query) && !step.code.toLowerCase().includes(query)) return false;
        return true;
      }),
    }));
  }, [summary, statusFilter, hideCompleted, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SiteSelector sites={displaySites} selectedSiteId={selectedSiteId} onChange={selectSite} />
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <Button
            type="button"
            size="sm"
            variant={tab === "tracker" ? "default" : "ghost"}
            className={cn("h-7")}
            onClick={() => setTab("tracker")}
          >
            Tracker
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "all" ? "default" : "ghost"}
            className={cn("h-7")}
            onClick={() => setTab("all")}
          >
            All sites
          </Button>
        </div>
      </div>

      {tab === "all" ? (
        <AllSitesTable sites={displaySites} onSelectSite={selectSite} />
      ) : loadingSummary || !summary ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <SummaryCard counts={summary.counts} progressPercent={summary.progressPercent} />
          <FiltersBar
            status={statusFilter}
            search={search}
            hideCompleted={hideCompleted}
            onStatusChange={setStatusFilter}
            onSearchChange={setSearch}
            onHideCompletedChange={setHideCompleted}
          />
          <div className="space-y-3">
            {filteredSections.map((section) => (
              <SectionAccordion
                key={section.id}
                siteId={summary.site.id}
                section={section}
                defaultOpen={openSectionIds.has(section.id)}
                canEdit={canEdit}
                isAdmin={isAdmin}
                onStatusChange={(stepId, status) => void patchStep(stepId, { status })}
                onFieldSave={(stepId, field, value) => void patchStep(stepId, { [field]: value })}
                onEvidenceChange={handleEvidenceChange}
                onConfirmCompleted={(stepId) => patchStep(stepId, { status: "COMPLETED" })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
