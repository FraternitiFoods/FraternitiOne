"use client";

import { useEffect, useMemo, useState } from "react";
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
}: {
  currentUserName: string;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<"tracker" | "all">("tracker");
  const [sites, setSites] = useState<SiteProgressRow[] | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(new Set());
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);

  // Load the site list once, then pick the initial selected site (remembered from localStorage if still valid).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tracker/sites");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not load sites.");
        if (cancelled) return;
        const list = body.sites as SiteProgressRow[];
        setSites(list);
        const remembered = readLastSiteId();
        const initial = list.find((s) => s.site.id === remembered)?.site.id ?? list[0]?.site.id ?? null;
        setSelectedSiteId(initial);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load sites.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected site's full tracker whenever the selection changes.
  useEffect(() => {
    if (!selectedSiteId) return;
    let cancelled = false;
    (async () => {
      setLoadingSummary(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/tracker/sites/${selectedSiteId}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not load this site's tracker.");
        if (cancelled) return;
        const newSummary = body as SiteSummary;
        setSummary(newSummary);
        setOpenSectionIds(computeDefaultOpenSection(newSummary));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load this site's tracker.");
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

  if (loadError && !sites) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

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
