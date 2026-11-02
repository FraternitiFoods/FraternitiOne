"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";
import { STATUS_LABELS, STATUS_BADGE_CLASSES, type TrackerStatus } from "./types";

const STATUSES: TrackerStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"];

export function StatusSelect({
  value,
  disabled,
  onChange,
}: {
  value: TrackerStatus;
  disabled?: boolean;
  onChange: (status: TrackerStatus) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v) onChange(v as TrackerStatus);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn("w-[8.5rem] rounded-full border-0 font-medium", STATUS_BADGE_CLASSES[value])}
      >
        <SelectValue>{STATUS_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            <span className={cn("inline-block size-2 rounded-full", STATUS_BADGE_CLASSES[status])} />
            {STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
