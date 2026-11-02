"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ProgressBar } from "./progress-bar";
import type { SiteProgressRow } from "./types";

/** site-tracker-plan.md section 6: "All sites" tab — click a row to open that site's tracker. */
export function AllSitesTable({ sites, onSelectSite }: { sites: SiteProgressRow[]; onSelectSite: (siteId: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Site</TableHead>
            <TableHead className="w-40">Progress</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">In progress</TableHead>
            <TableHead className="text-right">Not started</TableHead>
            <TableHead className="text-right">Not required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No tracker sites yet.
              </TableCell>
            </TableRow>
          )}
          {sites.map((row) => (
            <TableRow
              key={row.site.id}
              className="cursor-pointer"
              onClick={() => onSelectSite(row.site.id)}
            >
              <TableCell className="font-medium hover:underline">{row.site.name}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <ProgressBar percent={row.progressPercent} className="w-24" />
                  <span className="text-xs text-muted-foreground">{row.progressPercent.toFixed(0)}%</span>
                </div>
              </TableCell>
              <TableCell className="text-right">{row.counts.completed}</TableCell>
              <TableCell className="text-right">{row.counts.inProgress}</TableCell>
              <TableCell className="text-right">{row.counts.notStarted}</TableCell>
              <TableCell className="text-right">{row.counts.notRequired}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
