import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getAllSites } from "@/lib/boq-data";
import { getAppSettings } from "@/lib/app-settings";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { SearchBox } from "../_components/search-box";

/** plan.md section 4.6 — Sites (Admin). Read-only list (milestone M3); add/rename lands in M5. */
export default async function SitesPage(props: PageProps<"/site-boq/sites">) {
  await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim().toLowerCase();

  const [sites, settings] = await Promise.all([getAllSites(), getAppSettings()]);
  const visibleSites = q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites;

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="sites" />

      {settings.mode === "SHEET_LIVE" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Sheet is live — site names and opening dates sync from the sheet and are read-only here.
        </p>
      )}

      <SearchBox paramName="q" defaultValue={q} placeholder="Search sites…" />

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Short code</TableHead>
              <TableHead>Opening date</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleSites.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No sites match &quot;{q}&quot;.
                </TableCell>
              </TableRow>
            )}
            {visibleSites.map((site) => (
              <TableRow key={site.id}>
                <TableCell className="font-medium">{site.name}</TableCell>
                <TableCell className="text-muted-foreground">{site.shortCode || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(site.openingDate)}</TableCell>
                <TableCell className="text-muted-foreground">{site.note || "—"}</TableCell>
                <TableCell>
                  <Badge variant={site.isActive ? "outline" : "secondary"}>{site.isActive ? "Active" : "Hidden"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
