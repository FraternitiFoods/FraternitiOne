"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SiteProgressRow } from "./types";

/** site-tracker-plan.md section 6: searchable site selector. Base UI's Select supports type-ahead-to-jump by typing a site's first letters — ~22 sites fits comfortably without a bespoke combobox. */
export function SiteSelector({
  sites,
  selectedSiteId,
  onChange,
}: {
  sites: SiteProgressRow[];
  selectedSiteId: string | null;
  onChange: (siteId: string) => void;
}) {
  return (
    <Select value={selectedSiteId ?? ""} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue placeholder="Select a site…">
          {(value: string | null) => sites.find((row) => row.site.id === value)?.site.name ?? "Select a site…"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sites.map((row) => (
          <SelectItem key={row.site.id} value={row.site.id}>
            {row.site.name}
            <span className="text-xs text-muted-foreground">{row.progressPercent.toFixed(0)}%</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
