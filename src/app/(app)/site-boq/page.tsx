import Link from "next/link";
import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getActiveSites, getActiveCategories, getComputedItems } from "@/lib/boq-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { SiteBoqSubNav } from "./_components/sub-nav";
import { SearchBox } from "./_components/search-box";
import { SiteLockBadge } from "./_components/site-lock-badge";

/** plan.md section 4.1 — Overview (the sheet's "Dashboard"). */
export default async function SiteBoqOverviewPage(props: PageProps<"/site-boq">) {
  await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const qParam = searchParams.q;
  const q = (typeof qParam === "string" ? qParam : "").trim().toLowerCase();

  const [sites, categories, items] = await Promise.all([
    getActiveSites(),
    getActiveCategories(),
    getComputedItems(),
  ]);

  const matrix = new Map<string, Map<string, number>>(sites.map((s) => [s.id, new Map()]));
  const categoryTotals = new Map<string, number>();
  const siteTotals = new Map<string, number>();
  const siteHasQty = new Set<string>();
  let grandTotal = 0;

  for (const item of items) {
    for (const entry of item.siteEntries) {
      const row = matrix.get(entry.siteId);
      if (!row) continue; // site soft-deactivated since this item's data was loaded
      if (entry.qty > 0) siteHasQty.add(entry.siteId);
      if (entry.amount === 0) continue;

      row.set(item.categoryId, (row.get(item.categoryId) ?? 0) + entry.amount);
      categoryTotals.set(item.categoryId, (categoryTotals.get(item.categoryId) ?? 0) + entry.amount);
      siteTotals.set(entry.siteId, (siteTotals.get(entry.siteId) ?? 0) + entry.amount);
      grandTotal += entry.amount;
    }
  }

  const highestCategory = categories.reduce<{ name: string; total: number } | null>((best, c) => {
    const total = categoryTotals.get(c.id) ?? 0;
    return !best || total > best.total ? { name: c.displayName, total } : best;
  }, null);

  const highestSite = sites.reduce<{ name: string; total: number } | null>((best, s) => {
    const total = siteTotals.get(s.id) ?? 0;
    return !best || total > best.total ? { name: s.name, total } : best;
  }, null);

  const lowestSiteWithQty = sites
    .filter((s) => siteHasQty.has(s.id))
    .reduce<{ name: string; total: number } | null>((lowest, s) => {
      const total = siteTotals.get(s.id) ?? 0;
      return !lowest || total < lowest.total ? { name: s.name, total } : lowest;
    }, null);

  const averagePerSite = sites.length > 0 ? grandTotal / sites.length : 0;

  const visibleSites = q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites;

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="overview" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <InsightCard label="Grand total" value={formatCurrency(grandTotal)} />
        <InsightCard
          label="Highest-value category"
          value={highestCategory ? formatCurrency(highestCategory.total) : "—"}
          sub={highestCategory?.name}
        />
        <InsightCard
          label="Highest-value site"
          value={highestSite ? formatCurrency(highestSite.total) : "—"}
          sub={highestSite?.name}
        />
        <InsightCard
          label="Lowest-value site (with qty)"
          value={lowestSiteWithQty ? formatCurrency(lowestSiteWithQty.total) : "—"}
          sub={lowestSiteWithQty?.name}
        />
        <InsightCard label="Average per site" value={formatCurrency(averagePerSite)} />
        <InsightCard label="Sites" value={String(sites.length)} />
        <InsightCard label="Categories" value={String(categories.length)} />
      </div>

      <SearchBox paramName="q" defaultValue={q} placeholder="Search sites…" />

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-20 bg-card">Site</TableHead>
              {categories.map((c) => (
                <TableHead key={c.id} className="text-right">
                  {c.displayName}
                </TableHead>
              ))}
              <TableHead className="text-right font-semibold">Site Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleSites.length === 0 && (
              <TableRow>
                <TableCell colSpan={categories.length + 2} className="text-center text-sm text-muted-foreground">
                  No sites match &quot;{q}&quot;.
                </TableCell>
              </TableRow>
            )}
            {visibleSites.map((site) => {
              const row = matrix.get(site.id);
              return (
                <TableRow key={site.id}>
                  <TableCell className="sticky left-0 z-10 bg-card font-medium">
                    <Link href={`/site-boq/site-view?site=${site.id}`} className="hover:underline">
                      {site.name}
                    </Link>
                    <SiteLockBadge locked={site.isLocked} />
                  </TableCell>
                  {categories.map((c) => (
                    <TableCell key={c.id} className="text-right text-muted-foreground">
                      {formatCurrency(row?.get(c.id) ?? 0)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold">{formatCurrency(siteTotals.get(site.id) ?? 0)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {visibleSites.length > 0 && (
            <tfoot>
              <TableRow className="border-t bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell className="sticky left-0 z-10 bg-muted/50">All Sites</TableCell>
                {categories.map((c) => (
                  <TableCell key={c.id} className="text-right">
                    {formatCurrency(categoryTotals.get(c.id) ?? 0)}
                  </TableCell>
                ))}
                <TableCell className="text-right">{formatCurrency(grandTotal)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}

function InsightCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
