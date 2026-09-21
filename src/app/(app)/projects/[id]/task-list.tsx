"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterSelect, FILTER_ALL } from "@/components/filter-select";
import { TaskCard, STATUS_OPTIONS, type TaskCardData } from "./task-card";
import { DEPARTMENT_LABELS, LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_ORDER, TASK_STATUS_LABELS } from "@/lib/format";

const PAGE_SIZE = 10;
const NO_CATEGORY = "__none__";

/**
 * Client wrapper around the flat Tasks list (search box, category/status/
 * stage filters, "load 10 more" — Apoorv's ask, 2026-09-21, once the BOQ/Ops
 * checklist pushed a project up to ~700+ tasks). Everything runs client-side
 * against the already-fetched array rather than round-tripping to the
 * server, since the page already loads every task for the progress tiles
 * above.
 */
export function TaskList({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: (TaskCardData & { canAct: boolean; category: string | null })[];
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL);
  const [stageFilter, setStageFilter] = useState(FILTER_ALL);
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
  const handleStageChange = resetPage(setStageFilter);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    for (const t of tasks) {
      if (t.category) set.add(t.category);
      else hasUncategorized = true;
    }
    const opts = Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
    if (hasUncategorized) opts.push({ value: NO_CATEGORY, label: "No category (lifecycle checklist)" });
    return opts;
  }, [tasks]);

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
    []
  );

  const stageOptions = useMemo(
    () => LIFECYCLE_STAGE_ORDER.map((s) => ({ value: s, label: LIFECYCLE_STAGE_LABELS[s] })),
    []
  );

  const hasActiveFilters = categoryFilter !== FILTER_ALL || statusFilter !== FILTER_ALL || stageFilter !== FILTER_ALL;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (categoryFilter !== FILTER_ALL) {
        const matches = categoryFilter === NO_CATEGORY ? task.category === null : task.category === categoryFilter;
        if (!matches) return false;
      }
      if (statusFilter !== FILTER_ALL && task.status !== statusFilter) return false;
      if (stageFilter !== FILTER_ALL && task.lifecycleStage !== stageFilter) return false;
      if (!q) return true;
      const haystack = [
        task.title,
        task.description ?? "",
        DEPARTMENT_LABELS[task.module as keyof typeof DEPARTMENT_LABELS] ?? task.module,
        LIFECYCLE_STAGE_LABELS[task.lifecycleStage],
        task.owner.name,
        task.createdBy.name,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, categoryFilter, statusFilter, stageFilter, tasks]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search tasks by title, owner, module, stage…"
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
        <FilterSelect value={stageFilter} onChange={handleStageChange} options={stageOptions} allLabel="All stages" />
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategoryFilter(FILTER_ALL);
              setStatusFilter(FILTER_ALL);
              setStageFilter(FILTER_ALL);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tasks.length === 0 ? "No tasks yet." : "No tasks match your search and filters."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length} task{filtered.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-3">
            {visible.map((task) => (
              <TaskCard key={task.id} projectId={projectId} canAct={task.canAct} task={task} />
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
