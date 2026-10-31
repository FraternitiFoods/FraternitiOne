import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getPurchaseOrderById } from "@/lib/boq-data";
import { decToNumber } from "@/lib/boq-calc";
import { collectMissingPoFields, type PoPdfCompany, type PoPdfVendor } from "@/lib/po-pdf";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { SiteBoqSubNav } from "../../_components/sub-nav";

/** plan.md section 4.5 — PO detail: view the snapshot taken at creation time, re-download the PDF. */
export default async function PurchaseOrderDetailPage(props: PageProps<"/site-boq/purchase-orders/[id]">) {
  await requireSiteBoqUser();
  const { id } = await props.params;

  const po = await getPurchaseOrderById(id);
  if (!po) notFound();

  const company = po.companySnapshot as unknown as PoPdfCompany;
  const vendor = po.vendorSnapshot as unknown as PoPdfVendor;
  const site = po.siteSnapshot as unknown as { name: string; shortCode: string | null; note: string | null };
  const terms = (po.termsSnapshot as unknown as { poTerms: string[] }).poTerms ?? [];
  const missing = collectMissingPoFields({ company, vendor });

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="purchase-orders" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{po.poNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {po.site.name} &middot; {po.category.displayName} &middot; {po.vendor.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={po.status === "ISSUED" ? "outline" : "secondary"}>{po.status}</Badge>
          <Button render={<a href={`/api/site-boq/purchase-orders/${po.id}/pdf`} target="_blank" rel="noopener noreferrer" />}>
            Download PDF
          </Button>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Missing before sending: {missing.join(", ")}. The PDF marks these clearly — fill them in via Settings / Vendors, then
          re-download.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="PO date" value={formatDate(po.poDate)} />
            <Row label="Delivery by" value={po.deliveryBy ? formatDate(po.deliveryBy) : "—"} />
            <Row label="Delivery days" value={String(po.deliveryDays)} />
            <Row label="Payment terms" value={po.paymentTerms} />
            <Row label="GST %" value={`${decToNumber(po.gstPercent)}%`} />
            <Row label="Created by" value={`${po.createdBy.name} (${po.createdBy.email})`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendor (at creation time)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Name" value={vendor.name} />
            <Row label="Address" value={vendor.address || "—"} />
            <Row label="GSTIN" value={vendor.gstin || "—"} />
            <Row label="Phone" value={vendor.phone || "—"} />
            <Row label="Email" value={vendor.email || "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deliver to (at creation time)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Site" value={site.shortCode ? `${site.name} (${site.shortCode})` : site.name} />
            <Row label="Note" value={site.note || "—"} />
          </CardContent>
        </Card>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
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
            {po.lines.map((line) => {
              const rate = decToNumber(line.rate) ?? 0;
              return (
              <TableRow key={line.id}>
                <TableCell className="font-medium">{line.nameSnapshot}</TableCell>
                <TableCell className="text-muted-foreground">{line.remarkSize || "—"}</TableCell>
                <TableCell className="text-right">{formatNumber(decToNumber(line.qty) ?? 0)}</TableCell>
                <TableCell className={rate > 0 ? "text-right" : "text-right text-destructive"}>
                  {rate > 0 ? formatCurrency(rate, 2) : "No rate"}
                </TableCell>
                <TableCell className="text-right">{formatCurrency(decToNumber(line.amount), 2)}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
          <tfoot>
            <TableRow className="border-t bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={4} className="text-right font-medium">
                Subtotal
              </TableCell>
              <TableCell className="text-right font-medium">{formatCurrency(decToNumber(po.subtotal), 2)}</TableCell>
            </TableRow>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={4} className="text-right text-muted-foreground">
                GST ({decToNumber(po.gstPercent)}%)
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{formatCurrency(decToNumber(po.gstAmount), 2)}</TableCell>
            </TableRow>
            <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
              <TableCell colSpan={4} className="text-right">
                Grand Total
              </TableCell>
              <TableCell className="text-right">{formatCurrency(decToNumber(po.total), 2)}</TableCell>
            </TableRow>
          </tfoot>
        </Table>
      </div>

      {terms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
              {terms.map((term, i) => (
                <li key={i}>{term}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Link href="/site-boq/purchase-orders" className="text-sm text-primary hover:underline">
        &larr; Back to Purchase Orders
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
