import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { db } from "@/lib/db";
import { getActiveSites, getActiveCategories, getComputedItems } from "@/lib/boq-data";
import { PageHeader } from "@/components/page-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { QuerySelect } from "../_components/query-select";
import { SearchBox } from "../_components/search-box";

/** plan.md section 4.3 — Items & Qty (the sheet's "RM - <Category>" tabs), read-only (milestone M3). */
export default async function ItemsPage(props: PageProps<"/site-boq/items">) {
  await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const [sites, categories, items] = await Promise.all([getActiveSites(), getActiveCategories(), getComputedItems()]);

  if (sites.length === 0 || categories.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
        <SiteBoqSubNav active="items" />
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No sites or categories yet — import from the sheet first.
        </div>
      </div>
    );
  }

  const requestedSiteId = typeof searchParams.site === "string" ? searchParams.site : undefined;
  const requestedCategoryId = typeof searchParams.category === "string" ? searchParams.category : undefined;
  const selectedSite = sites.find((s) => s.id === requestedSiteId) ?? sites[0];
  const selectedCategory = categories.find((c) => c.id === requestedCategoryId) ?? categories[0];
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim().toLowerCase();

  const categoryVendorRows = await db.categoryVendor.findMany({
    where: { categoryId: selectedCategory.id },
    include: { vendor: { select: { id: true, name: true } } },
  });
  const categoryVendors = categoryVendorRows.map((cv) => cv.vendor).sort((a, b) => a.name.localeCompare(b.name));

  const categoryItems = items
    .filter((item) => item.categoryId === selectedCategory.id)
    .filter((item) => !q || item.name.toLowerCase().includes(q));

  const rows = categoryItems.map((item) => {
    const siteEntry = item.siteEntries.find((e) => e.siteId === selectedSite.id) ?? null;
    const allSitesQty = item.siteEntries.reduce((sum, e) => sum + e.qty, 0);
    const allSitesAmount = item.siteEntries.reduce((sum, e) => sum + e.amount, 0);
    return { item, siteEntry, allSitesQty, allSitesAmount };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      qty: acc.qty + (row.siteEntry?.qty ?? 0),
      amount: acc.amount + (row.siteEntry?.amount ?? 0),
      allSitesQty: acc.allSitesQty + row.allSitesQty,
      allSitesAmount: acc.allSitesAmount + row.allSitesAmount,
    }),
    { qty: 0, amount: 0, allSitesQty: 0, allSitesAmount: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="items" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Category</span>
        <QuerySelect
          paramName="category"
          value={selectedCategory.id}
          ariaLabel="Select category"
          options={categories.map((c) => ({ value: c.id, label: c.displayName }))}
        />
        <span className="text-sm text-muted-foreground">Site</span>
        <QuerySelect
          paramName="site"
          value={selectedSite.id}
          ariaLabel="Select site"
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
        <div className="ml-auto">
          <SearchBox
            paramName="q"
            defaultValue={q}
            placeholder="Search items…"
            preserveParams={{ category: selectedCategory.id, site: selectedSite.id }}
          />
        </div>
      </div>

      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Sheet is live — data syncs from the sheet. Editing lands in a later milestone.
      </p>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Remark / Size</TableHead>
              <TableHead className="text-right">Qty ({selectedSite.name})</TableHead>
              <TableHead>Final vendor</TableHead>
              <TableHead className="text-right">Final rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {categoryVendors.map((v) => (
                <TableHead key={v.id} className="text-right">
                  {v.name}
                </TableHead>
              ))}
              <TableHead className="text-right">All-sites qty</TableHead>
              <TableHead className="text-right">All-sites cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7 + categoryVendors.length} className="text-center text-sm text-muted-foreground">
                  No items in this category{q ? ` matching "${q}"` : ""}.
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ item, siteEntry, allSitesQty, allSitesAmount }) => {
              const qty = siteEntry?.qty ?? 0;
              const missingRate = qty > 0 && !siteEntry?.hasRate;
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{siteEntry?.remarkSize || "—"}</TableCell>
                  <TableCell className={missingRate ? "text-right font-medium text-destructive" : "text-right"}>
                    {formatNumber(qty)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.finalVendorName ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {item.finalRate !== null ? (
                      formatCurrency(item.finalRate, 2)
                    ) : (
                      <span className="text-destructive">No rate</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(siteEntry?.amount ?? 0, 2)}</TableCell>
                  {categoryVendors.map((v) => {
                    const vr = item.vendorRates.find((x) => x.vendorId === v.id);
                    return (
                      <TableCell key={v.id} className="text-right text-muted-foreground">
                        {vr?.rate ? formatCurrency(vr.rate, 2) : "—"}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right text-muted-foreground">{formatNumber(allSitesQty)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(allSitesAmount, 2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {rows.length > 0 && (
            <tfoot>
              <TableRow className="border-t bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right">{formatNumber(totals.qty)}</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right">{formatCurrency(totals.amount, 2)}</TableCell>
                {categoryVendors.map((v) => (
                  <TableCell key={v.id} />
                ))}
                <TableCell className="text-right">{formatNumber(totals.allSitesQty)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.allSitesAmount, 2)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
