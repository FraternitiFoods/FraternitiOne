"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterSelect, FILTER_ALL } from "@/components/filter-select";
import { STATUS_OPTIONS } from "../projects/[id]/task-card";
import {
  DEPARTMENT_LABELS,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_ORDER,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatProjectCode,
} from "@/lib/format";
import { TASK_PRIORITY_BADGE_CLASS, TASK_STATUS_BADGE_CLASS } from "@/lib/badge-colors";
import type { Department, LifecycleStage, TaskPriority, TaskStatus } from "@prisma/client";

const PAGE_SIZE = 10;
const NO_CATEGORY = "__none__";

export type ActionItem = {
  id: string;
  title: string;
  module: Department;
  category: string | null;
  lifecycleStage: LifecycleStage;
  projectId: string;
  projectSeq: number;
  projectBrand: string;
  projectLocation: string;
  dueDate: string | null;
  overdue: boolean;
  priority: TaskPriority;
  status: TaskStatus;
};

/**
 * Client wrapper (search box, category/status/stage filters, "load 10 more")
 * around the Action Centre's task list — same pattern as the project page's
 * TaskList, requested alongside it (2026-09-21) once the BOQ/Ops checklist
 * made these lists long enough to need it.
 */
export function ActionsList({ items }: { items: ActionItem[] }) {
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
    for (const item of items) {
      if (item.category) set.add(item.category);
      else hasUncategorized = true;
    }
    const opts = Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
    if (hasUncategorized) opts.push({ value: NO_CATEGORY, label: "No category (lifecycle checklist)" });
    return opts;
  }, [items]);

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
    return items.filter((item) => {
      if (categoryFilter !== FILTER_ALL) {
        const matches = categoryFilter === NO_CATEGORY ? item.category === null : item.category === categoryFilter;
        if (!matches) return false;
      }
      if (statusFilter !== FILTER_ALL && item.status !== statusFilter) return false;
      if (stageFilter !== FILTER_ALL && item.lifecycleStage !== stageFilter) return false;
      if (!q) return true;
      return [
        item.title,
        DEPARTMENT_LABELS[item.module],
        LIFECYCLE_STAGE_LABELS[item.lifecycleStage],
        item.projectBrand,
        item.projectLocation,
        formatProjectCode(item.projectSeq),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [search, categoryFilter, statusFilter, stageFilter, items]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search tasks by title, module, stage, project…"
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

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {items.length === 0 ? "Nothing needs your attention right now." : "No tasks match your search and filters."}
          </p>
        ) : (
          <div className="divide-y">
            {visible.map((task) => (
              <Link
                key={task.id}
                href={`/projects/${task.projectId}/stages/${task.lifecycleStage}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <Badge variant="outline">{DEPARTMENT_LABELS[task.module]}</Badge>
                    {task.category && <Badge variant="outline">{task.category}</Badge>}
                    <Badge variant="outline">{LIFECYCLE_STAGE_LABELS[task.lifecycleStage]}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatProjectCode(task.projectSeq)} — {task.projectBrand}, {task.projectLocation}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {task.dueDate && (
                    <span className={task.overdue ? "text-xs font-medium text-red-600" : "text-xs text-muted-foreground"}>
                      Due {formatDate(task.dueDate)}
                    </span>
                  )}
                  <Badge variant="outline" className={TASK_PRIORITY_BADGE_CLASS[task.priority]}>
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </Badge>
                  <Badge variant="outline" className={TASK_STATUS_BADGE_CLASS[task.status]}>
                    {TASK_STATUS_LABELS[task.status]}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length} task{filtered.length === 1 ? "" : "s"}
          </p>
          {hasMore && (
            <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
              Load 10 more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
