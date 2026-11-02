"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_LABELS, type TrackerStatus } from "./types";

export type StatusFilter = TrackerStatus | "ALL";

export function FiltersBar({
  status,
  search,
  hideCompleted,
  onStatusChange,
  onSearchChange,
  onHideCompletedChange,
}: {
  status: StatusFilter;
  search: string;
  hideCompleted: boolean;
  onStatusChange: (status: StatusFilter) => void;
  onSearchChange: (search: string) => void;
  onHideCompletedChange: (hide: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search step name or code…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-8 w-full sm:w-56"
      />
      <Select value={status} onValueChange={(v) => v && onStatusChange(v as StatusFilter)}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All statuses</SelectItem>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={hideCompleted}
          onChange={(e) => onHideCompletedChange(e.target.checked)}
          className="size-3.5"
        />
        Hide completed
      </label>
    </div>
  );
}
