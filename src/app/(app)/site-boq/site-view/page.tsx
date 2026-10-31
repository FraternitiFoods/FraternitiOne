import Link from "next/link";
import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getActiveSites, getActiveCategories, getComputedItems } from "@/lib/boq-data";
import { getAppSettings } from "@/lib/app-settings";
import { canLockSite } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatDate, daysUntil } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { QuerySelect } from "../_components/query-select";
import { SiteLockBadge } from "../_components/site-lock-badge";
import { SiteLockButton } from "../_components/site-lock-button";

type SiteAgg = { itemsCount: number; ratesMissing: number; notOrdered: number; ordered: number; orderValue: number };
type CategoryAgg = SiteAgg & { poAmount: number; advanceGiven: number };

function emptySiteAgg(): SiteAgg {
  return { itemsCount: 0, ratesMissing: 0, notOrdered: 0, ordered: 0, orderValue: 0 };
}
function emptyCategoryAgg(): CategoryAgg {
  return { ...emptySiteAgg(), poAmount: 0, advanceGiven: 0 };
}

function openingStatus(
  openingDate: Date | null,
  urgentDays: number,
  soonDays: number
): { label: string; className: string } {
  if (!openingDate) return { label: "No date", className: "bg-muted text-muted-foreground" };
  const days = daysUntil(openingDate);
  if (days < 0) return { label: "Opened", className: "bg-muted text-muted-foreground" };
  if (days <= urgentDays) return { label: "Urgent", className: "bg-destructive/10 text-destructive" };
  if (days <= soonDays) return { label: "This month", className: "bg-amber-100 text-amber-800" };
  return { label: "On track", className: "bg-muted text-muted-foreground" };
}

/** plan.md section 4.2 — Site view (the sheet's "Site Dashboard"). */
export default async function SiteViewPage(props: PageProps<"/site-boq/site-view">) {
  const user = await requireSiteBoqUser();
  const canLock = canLockSite(user);

  const searchParams = await props.searchParams;
  const pendingCategory = typeof searchParams.pendingCategory === "string" ? searchParams.pendingCategory : "all";
  const pendingStatus = typeof searchParams.pendingStatus === "string" ? searchParams.pendingStatus : "all";

  const [sites, categories, items, settings] = await Promise.all([
    getActiveSites(),
    getActiveCategories(),
    getComputedItems(),
    getAppSettings(),
  ]);

  if (sites.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
        <SiteBoqSubNav active="site-view" />
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No sites yet — import from the sheet first.
        </div>
      </div>
    );
  }

  const requestedSiteId = typeof searchParams.site === "string" ? searchParams.site : undefined;
  const selectedSite = sites.find((s) => s.id === requestedSiteId) ?? sites[0];

  const categoryAgg = new Map<string, CategoryAgg>(categories.map((c) => [c.id, emptyCategoryAgg()]));
  const siteAgg = new Map<string, SiteAgg>(sites.map((s) => [s.id, emptySiteAgg()]));

  for (const item of items) {
    for (const entry of item.siteEntries) {
      const site = siteAgg.get(entry.siteId);
      if (site) {
        if (entry.qty > 0) {
          site.itemsCount += 1;
          if (!entry.hasRate) site.ratesMissing += 1;
          if (entry.ordered) site.ordered += 1;
          else site.notOrdered += 1;
        }
        site.orderValue += entry.amount;
      }

      if (entry.siteId === selectedSite.id) {
        const cat = categoryAgg.get(item.categoryId);
        if (cat) {
          if (entry.qty > 0) {
            cat.itemsCount += 1;
            if (!entry.hasRate) cat.ratesMissing += 1;
            if (entry.ordered) cat.ordered += 1;
            else cat.notOrdered += 1;
          }
          cat.orderValue += entry.amount;
          cat.poAmount += entry.poAmount ?? 0;
          cat.advanceGiven += entry.advanceGiven ?? 0;
        }
      }
    }
  }

  const banner = siteAgg.get(selectedSite.id) ?? emptySiteAgg();

  const pendingRows = items.flatMap((item) => {
    const entry = item.siteEntries.find((e) => e.siteId === selectedSite.id);
    if (!entry || entry.qty <= 0) return [];
    if (entry.hasRate && entry.ordered) return []; // only items missing a rate or not yet ordered
    if (pendingCategory !== "all" && item.categoryId !== pendingCategory) return [];
    if (pendingStatus === "no-rate" && entry.hasRate) return [];
    if (pendingStatus === "not-ordered" && entry.ordered) return [];
    const category = categories.find((c) => c.id === item.categoryId);
    return [{ item, entry, category }];
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="site-view" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Site</span>
        <QuerySelect
          paramName="site"
          value={selectedSite.id}
          ariaLabel="Select site"
          options={sites.map((s) => ({ value: s.id, label: s.isLocked ? `${s.name} (Locked)` : s.name }))}
        />
        <SiteLockBadge locked={selectedSite.isLocked} className="align-middle" />
        {canLock && <SiteLockButton siteId={selectedSite.id} siteName={selectedSite.name} isLocked={selectedSite.isLocked} />}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BannerCard label="Total items" value={banner.itemsCount} />
        <BannerCard label="Rates missing" value={banner.ratesMissing} tone={banner.ratesMissing > 0 ? "warn" : undefined} />
        <BannerCard label="Not ordered" value={banner.notOrdered} />
        <BannerCard label="Ordered" value={banner.ordered} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          By category — {selectedSite.name}
          <SiteLockBadge locked={selectedSite.isLocked} />
        </h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Rates missing</TableHead>
                <TableHead className="text-right">Not ordered</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Order value</TableHead>
                <TableHead className="text-right">PO amount</TableHead>
                <TableHead className="text-right">Advance given</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => {
                const agg = categoryAgg.get(c.id) ?? emptyCategoryAgg();
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.displayName}</TableCell>
                    <TableCell className="text-right">{agg.itemsCount}</TableCell>
                    <TableCell className="text-right">
                      {agg.ratesMissing > 0 ? (
                        <span className="text-destructive">{agg.ratesMissing}</span>
                      ) : (
                        agg.ratesMissing
                      )}
                    </TableCell>
                    <TableCell className="text-right">{agg.notOrdered}</TableCell>
                    <TableCell className="text-right">{agg.ordered}</TableCell>
                    <TableCell className="text-right">{formatCurrency(agg.orderValue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(agg.poAmount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(agg.advanceGiven)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(agg.poAmount - agg.advanceGiven)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/site-boq/items?site=${selectedSite.id}&category=${c.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Opening reminder — all sites</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead>Opening date</TableHead>
                <TableHead className="text-right">Days left</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Rates missing</TableHead>
                <TableHead className="text-right">Not ordered</TableHead>
                <TableHead className="text-right">Order value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => {
                const agg = siteAgg.get(s.id) ?? emptySiteAgg();
                const status = openingStatus(s.openingDate, settings.urgentDays, settings.soonDays);
                const days = s.openingDate ? daysUntil(s.openingDate) : null;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link href={`/site-boq/site-view?site=${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                      <SiteLockBadge locked={s.isLocked} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(s.openingDate)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{days !== null ? days : "—"}</TableCell>
                    <TableCell className="text-right">{agg.itemsCount}</TableCell>
                    <TableCell className="text-right">{agg.ordered}</TableCell>
                    <TableCell className="text-right">{agg.ratesMissing}</TableCell>
                    <TableCell className="text-right">{agg.notOrdered}</TableCell>
                    <TableCell className="text-right">{formatCurrency(agg.orderValue)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status.className}>
                        {status.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            What&apos;s pending — {selectedSite.name}
            <SiteLockBadge locked={selectedSite.isLocked} />
          </h2>
          <div className="flex items-center gap-2">
            <QuerySelect
              paramName="pendingCategory"
              value={pendingCategory}
              ariaLabel="Filter by category"
              options={[{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.displayName }))]}
            />
            <QuerySelect
              paramName="pendingStatus"
              value={pendingStatus}
              ariaLabel="Filter by status"
              options={[
                { value: "all", label: "All statuses" },
                { value: "no-rate", label: "No rate" },
                { value: "not-ordered", label: "Not ordered" },
              ]}
            />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Nothing pending for this site.
                  </TableCell>
                </TableRow>
              )}
              {pendingRows.map(({ item, entry, category }) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{category?.displayName}</TableCell>
                  <TableCell className="text-muted-foreground">{item.finalVendorName ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatNumber(entry.qty)}</TableCell>
                  <TableCell className="text-right">
                    {entry.hasRate ? formatCurrency(entry.rate, 2) : <span className="text-destructive">No rate</span>}
                  </TableCell>
                  <TableCell>
                    {entry.ordered ? (
                      <Badge variant="outline">{entry.stage || "Ordered"}</Badge>
                    ) : (
                      <Badge variant="secondary">Not ordered</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function BannerCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={tone === "warn" && value > 0 ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
