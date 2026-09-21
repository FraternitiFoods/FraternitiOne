"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel used by both TaskList and ActionsList to mean "no filter applied". */
export const FILTER_ALL = "all";

/**
 * One filter dropdown (category / status / lifecycle stage), shared between
 * the project page's TaskList and the Action Centre's ActionsList — same
 * "All X" + option list shape in both places (2026-09-21).
 */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  className?: string;
}) {
  const labelFor = (v: string) => (v === FILTER_ALL ? allLabel : (options.find((o) => o.value === v)?.label ?? v));

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? FILTER_ALL)}>
      <SelectTrigger className={className ?? "h-9 w-[170px]"}>
        <SelectValue>{() => labelFor(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={FILTER_ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
