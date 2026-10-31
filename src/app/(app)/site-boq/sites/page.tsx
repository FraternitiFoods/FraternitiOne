import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getAllSites } from "@/lib/boq-data";
import { getAppSettings } from "@/lib/app-settings";
import { canEditSites, canLockSite } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { SearchBox } from "../_components/search-box";
import { SiteLockBadge } from "../_components/site-lock-badge";
import { SiteLockButton } from "../_components/site-lock-button";
import { SiteFormDialog } from "./_components/site-form-dialog";
import { SiteActiveToggle } from "./_components/site-active-toggle";

/** plan.md section 4.6 — Sites (Admin). Add/rename/hide gated to WEBSITE_LIVE by the Server Actions (section 1). */
export default async function SitesPage(props: PageProps<"/site-boq/sites">) {
  const user = await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim().toLowerCase();

  const [sites, settings] = await Promise.all([getAllSites(), getAppSettings()]);
  const visibleSites = q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites;

  const editable = canEditSites(user) && settings.mode === "WEBSITE_LIVE";
  const canLock = canLockSite(user);
  // Locking works in either mode (plan.md section 3), so the actions column
  // can be present even when regular site editing is read-only in SHEET_LIVE.
  const showActions = editable || canLock;

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="sites" />

      {settings.mode === "SHEET_LIVE" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Sheet is live — sites are read-only here until an Admin switches the mode in Settings.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <SearchBox paramName="q" defaultValue={q} placeholder="Search sites…" />
        {editable && <SiteFormDialog trigger={<Button size="sm">Add site</Button>} />}
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Short code</TableHead>
              <TableHead>Opening date</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
              {showActions && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleSites.length === 0 && (
              <TableRow>
                <TableCell colSpan={showActions ? 6 : 5} className="text-center text-sm text-muted-foreground">
                  No sites match &quot;{q}&quot;.
                </TableCell>
              </TableRow>
            )}
            {visibleSites.map((site) => (
              <TableRow key={site.id}>
                <TableCell className="font-medium">
                  {site.name}
                  <SiteLockBadge locked={site.isLocked} />
                </TableCell>
                <TableCell className="text-muted-foreground">{site.shortCode || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(site.openingDate)}</TableCell>
                <TableCell className="text-muted-foreground">{site.note || "—"}</TableCell>
                <TableCell>
                  <Badge variant={site.isActive ? "outline" : "secondary"}>{site.isActive ? "Active" : "Hidden"}</Badge>
                </TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {editable && (
                        <SiteFormDialog
                          site={site}
                          trigger={
                            <Button variant="outline" size="sm">
                              Edit
                            </Button>
                          }
                        />
                      )}
                      {editable && <SiteActiveToggle siteId={site.id} isActive={site.isActive} />}
                      {canLock && <SiteLockButton siteId={site.id} siteName={site.name} isLocked={site.isLocked} />}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
