"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterSelect, FILTER_ALL } from "@/components/filter-select";
import { ComplaintCard, STATUS_OPTIONS, type ComplaintCardData } from "./complaint-card";
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS } from "@/lib/format";
import { COMPLAINT_CATEGORIES } from "@/lib/complaint-categories";

const PAGE_SIZE = 10;

/**
 * Same search/filter/"load 10 more" shape as TaskList (task-list.tsx) —
 * each item carries its own projectId (not a single prop) so this same
 * component works both scoped to one project page and unscoped on the
 * portfolio-wide /complaints page.
 */
export function ComplaintList({
  complaints,
  people,
}: {
  complaints: (ComplaintCardData & { projectId: string; canAct: boolean; canAssign: boolean })[];
  people: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setVisibleCount(PAGE_SIZE);
    };
  }
  const handleSearchChange = resetPage(setSearch);
  const handleCategoryChange = resetPage(setCategoryFilter);
  const handleStatusChange = resetPage(setStatusFilter);

  const categoryOptions = useMemo(
    () => COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: COMPLAINT_CATEGORY_LABELS[c] })),
    []
  );
  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((s) => ({ value: s, label: COMPLAINT_STATUS_LABELS[s] })),
    []
  );

  const hasActiveFilters = categoryFilter !== FILTER_ALL || statusFilter !== FILTER_ALL;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return complaints.filter((c) => {
      if (categoryFilter !== FILTER_ALL && c.category !== categoryFilter) return false;
      if (statusFilter !== FILTER_ALL && c.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [c.subject, c.description, COMPLAINT_CATEGORY_LABELS[c.category], c.raisedBy.name]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, categoryFilter, statusFilter, complaints]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search complaints by subject, description, raised by…"
          className="max-w-sm"
        />
        <FilterSelect
          value={categoryFilter}
          onChange={handleCategoryChange}
          options={categoryOptions}
          allLabel="All categories"
        />
        <FilterSelect
          value={statusFilter}
          onChange={handleStatusChange}
          options={statusOptions}
          allLabel="All statuses"
        />
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategoryFilter(FILTER_ALL);
              setStatusFilter(FILTER_ALL);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {complaints.length === 0 ? "No complaints yet." : "No complaints match your search and filters."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length} complaint{filtered.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-3">
            {visible.map((complaint) => (
              <ComplaintCard
                key={complaint.id}
                complaint={complaint}
                projectId={complaint.projectId}
                canAct={complaint.canAct}
                canAssign={complaint.canAssign}
                people={people}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load 10 more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
