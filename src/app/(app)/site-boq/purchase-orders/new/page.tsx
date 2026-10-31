import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { db } from "@/lib/db";
import { getActiveSites, getActiveCategories, getComputedItems } from "@/lib/boq-data";
import { getAppSettings } from "@/lib/app-settings";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildPoPreviews, resolveSelectedVendorIds } from "@/lib/po-calc";
import { collectMissingPoFields } from "@/lib/po-pdf";
import { SiteBoqSubNav } from "../../_components/sub-nav";
import { CreatePoForm } from "./_components/create-po-form";

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** plan.md section 4.5 — Create a PO: choose site/category/vendor(s), see a live preview, then create. */
export default async function NewPurchaseOrderPage(props: PageProps<"/site-boq/purchase-orders/new">) {
  await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const [sites, categories, settings] = await Promise.all([getActiveSites(), getActiveCategories(), getAppSettings()]);

  if (sites.length === 0 || categories.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
        <SiteBoqSubNav active="purchase-orders" />
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No sites or categories yet — import from the sheet first.
        </div>
      </div>
    );
  }

  const selectedSite = sites.find((s) => s.id === searchParams.site) ?? sites[0];
  const selectedCategory = categories.find((c) => c.id === searchParams.category) ?? categories[0];

  const categoryVendorRows = await db.categoryVendor.findMany({
    where: { categoryId: selectedCategory.id },
    include: { vendor: true },
  });
  const categoryVendors = categoryVendorRows.map((cv) => cv.vendor).sort((a, b) => a.name.localeCompare(b.name));

  const rawVendorParam = searchParams.vendor;
  const vendorSelectionRaw = Array.isArray(rawVendorParam) ? rawVendorParam : rawVendorParam ? [rawVendorParam] : [];
  // No selection yet (first visit to the page) defaults to "All vendors", not "none".
  const vendorSelection = vendorSelectionRaw.length > 0 ? vendorSelectionRaw : ["all"];
  const allVendorsChecked = vendorSelection.includes("all");

  const poDate = typeof searchParams.poDate === "string" && searchParams.poDate ? searchParams.poDate : todayIsoDate();
  const deliveryDaysRaw = typeof searchParams.deliveryDays === "string" ? Number(searchParams.deliveryDays) : NaN;
  const deliveryDays = Number.isFinite(deliveryDaysRaw) ? deliveryDaysRaw : settings.defaultDeliveryDays;
  const gstPercentRaw = typeof searchParams.gstPercent === "string" ? Number(searchParams.gstPercent) : NaN;
  const gstPercent = Number.isFinite(gstPercentRaw) ? gstPercentRaw : settings.defaultGstPercent;
  const paymentTerms =
    typeof searchParams.paymentTerms === "string" && searchParams.paymentTerms
      ? searchParams.paymentTerms
      : settings.defaultPaymentTerms;

  const resolvedVendorIds = resolveSelectedVendorIds(vendorSelection, categoryVendors.map((v) => v.id));
  const selectedVendors = categoryVendors.filter((v) => resolvedVendorIds.includes(v.id));

  const items = (await getComputedItems()).filter((item) => item.categoryId === selectedCategory.id);
  const previews =
    selectedVendors.length > 0 ? buildPoPreviews({ items, siteId: selectedSite.id, vendors: selectedVendors, gstPercent }) : [];

  const companySnapshot = {
    name: settings.companyName,
    address: settings.companyAddress,
    gstin: settings.companyGstin,
    phone: settings.companyPhone,
    email: settings.companyEmail,
    signatoryName: settings.signatoryName,
  };

  const missingByVendorId = new Map(
    previews.map((preview) => {
      const vendor = selectedVendors.find((v) => v.id === preview.vendorId)!;
      return [preview.vendorId, collectMissingPoFields({ company: companySnapshot, vendor })] as const;
    })
  );
  const anyMissing = [...missingByVendorId.values()].some((m) => m.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="purchase-orders" />

      <form method="get" className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="site">Site</Label>
            <select id="site" name="site" defaultValue={selectedSite.id} className={SELECT_CLASS}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isLocked ? `${s.name} (Locked)` : s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="category">Category</Label>
            <select id="category" name="category" defaultValue={selectedCategory.id} className={SELECT_CLASS}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="poDate">PO date</Label>
            <Input id="poDate" name="poDate" type="date" defaultValue={poDate} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deliveryDays">Delivery within (days)</Label>
            <Input id="deliveryDays" name="deliveryDays" type="number" min={0} defaultValue={deliveryDays} className="w-28" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gstPercent">GST %</Label>
            <Input id="gstPercent" name="gstPercent" type="number" min={0} max={100} step="0.01" defaultValue={gstPercent} className="w-24" />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="paymentTerms">Payment terms</Label>
          <Input id="paymentTerms" name="paymentTerms" defaultValue={paymentTerms} className="max-w-xl" />
        </div>

        <div className="space-y-1.5">
          <Label>Vendors</Label>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5 font-medium">
              <input type="checkbox" name="vendor" value="all" defaultChecked={allVendorsChecked} />
              All vendors
            </label>
            {categoryVendors.map((v) => (
              <label key={v.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="vendor" value={v.id} defaultChecked={allVendorsChecked || vendorSelection.includes(v.id)} />
                {v.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            While &quot;All vendors&quot; is checked, every vendor linked to this category is included regardless of the
            individual boxes above.
          </p>
        </div>

        <Button type="submit" variant="outline" size="sm">
          Update preview
        </Button>
      </form>

      {previews.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No items with qty &gt; 0 found for the selected vendor(s) in &quot;{selectedSite.name}&quot; / {selectedCategory.displayName}.
        </div>
      ) : (
        <div className="space-y-4">
          {previews.map((preview) => {
            const missing = missingByVendorId.get(preview.vendorId) ?? [];

            return (
              <div key={preview.vendorId} className="space-y-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <div className="flex items-center justify-between gap-2 border-b border-foreground/10 bg-muted/40 px-4 py-2">
                  <h2 className="text-sm font-semibold">{preview.vendorName}</h2>
                  <span className="text-sm text-muted-foreground">{preview.lines.length} item(s)</span>
                </div>

                {missing.length > 0 && (
                  <p className="px-4 text-xs text-destructive">Missing before sending: {missing.join(", ")}.</p>
                )}

                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Item</TableHead>
                      <TableHead>Remark / Size</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.lines.map((line) => (
                      <TableRow key={line.itemId}>
                        <TableCell className="font-medium">{line.name}</TableCell>
                        <TableCell className="text-muted-foreground">{line.remarkSize || "—"}</TableCell>
                        <TableCell className="text-right">{formatNumber(line.qty)}</TableCell>
                        <TableCell className={line.hasRate ? "text-right" : "text-right text-destructive"}>
                          {line.hasRate ? formatCurrency(line.rate, 2) : "No rate"}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(line.amount, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <TableRow className="border-t bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={4} className="text-right font-medium">
                        Subtotal
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(preview.totals.subtotal, 2)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={4} className="text-right text-muted-foreground">
                        GST ({gstPercent}%)
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(preview.totals.gstAmount, 2)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                      <TableCell colSpan={4} className="text-right">
                        Grand Total
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(preview.totals.total, 2)}</TableCell>
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            );
          })}

          <div className="flex items-center gap-2">
            <CreatePoForm
              siteId={selectedSite.id}
              categoryId={selectedCategory.id}
              vendorIds={vendorSelection}
              poDate={poDate}
              deliveryDays={deliveryDays}
              gstPercent={gstPercent}
              paymentTerms={paymentTerms}
            />
            {anyMissing && <Badge variant="outline">Will still generate — missing fields will be marked on the PDF</Badge>}
          </div>
        </div>
      )}
    </div>
  );
}
