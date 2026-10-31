import Link from "next/link";
import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getPurchaseOrders } from "@/lib/boq-data";
import { decToNumber } from "@/lib/boq-calc";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { SearchBox } from "../_components/search-box";

/** plan.md section 4.5 — PO list with search by number, site, vendor; open → view/re-download. */
export default async function PurchaseOrdersPage(props: PageProps<"/site-boq/purchase-orders">) {
  await requireSiteBoqUser();

  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim();
  const createdParam = typeof searchParams.created === "string" ? searchParams.created : "";
  const createdIds = new Set(createdParam.split(",").filter(Boolean));

  const purchaseOrders = await getPurchaseOrders(q);

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="purchase-orders" />

      {createdIds.size > 0 && (
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          Created {createdIds.size} purchase order{createdIds.size > 1 ? "s" : ""} — look for the &quot;New&quot; badge below.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <SearchBox paramName="q" defaultValue={q} placeholder="Search by PO number, site or vendor…" />
        <Button size="sm" render={<Link href="/site-boq/purchase-orders/new" />}>
          Create PO
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>PO Number</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>PO Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchaseOrders.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  {q ? `No purchase orders match "${q}".` : "No purchase orders yet."}
                </TableCell>
              </TableRow>
            )}
            {purchaseOrders.map((po) => (
              <TableRow key={po.id}>
                <TableCell className="font-medium">
                  <Link href={`/site-boq/purchase-orders/${po.id}`} className="hover:underline">
                    {po.poNumber}
                  </Link>
                  {createdIds.has(po.id) && (
                    <Badge variant="outline" className="ml-1.5 align-middle">
                      New
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{po.site.name}</TableCell>
                <TableCell className="text-muted-foreground">{po.category.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{po.vendor.name}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(po.poDate)}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(decToNumber(po.total), 2)}</TableCell>
                <TableCell>
                  <Badge variant={po.status === "ISSUED" ? "outline" : "secondary"}>{po.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={`/api/site-boq/purchase-orders/${po.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
                  >
                    Download PDF
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
