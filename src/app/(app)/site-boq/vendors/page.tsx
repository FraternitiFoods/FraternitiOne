import { requireSiteBoqUser } from "@/lib/site-boq-access";
import { getActiveCategories, getVendorsGroupedByCategory } from "@/lib/boq-data";
import { canEditVendors } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SiteBoqSubNav } from "../_components/sub-nav";
import { SearchBox } from "../_components/search-box";
import { VendorEditDialog } from "./_components/vendor-edit-dialog";

/** plan.md section 4.4 — Vendors, grouped by category. Contact details are Admin-editable in either mode. */
export default async function VendorsPage(props: PageProps<"/site-boq/vendors">) {
  const user = await requireSiteBoqUser();
  const editable = canEditVendors(user);

  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim().toLowerCase();

  const [categories, vendors] = await Promise.all([getActiveCategories(), getVendorsGroupedByCategory()]);

  const byCategory = new Map(categories.map((c) => [c.id, { category: c, vendors: [] as typeof vendors }]));
  for (const vendor of vendors) {
    if (q && !vendor.name.toLowerCase().includes(q)) continue;
    for (const cv of vendor.categoryVendors) {
      const bucket = byCategory.get(cv.categoryId);
      if (bucket) bucket.vendors.push(vendor);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />
      <SiteBoqSubNav active="vendors" />

      <SearchBox paramName="q" defaultValue={q} placeholder="Search vendors…" />

      <div className="space-y-6">
        {categories.map((category) => {
          const bucket = byCategory.get(category.id);
          const categoryVendors = bucket?.vendors ?? [];
          if (q && categoryVendors.length === 0) return null;

          return (
            <section key={category.id} className="space-y-2">
              <h2 className="text-sm font-semibold">{category.displayName}</h2>
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      {editable && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryVendors.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={editable ? 6 : 5} className="text-center text-sm text-muted-foreground">
                          No vendors yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {categoryVendors.map((vendor) => (
                      <TableRow key={vendor.id}>
                        <TableCell className="font-medium">{vendor.name}</TableCell>
                        <TableCell className="text-muted-foreground">{vendor.address || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{vendor.gstin || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{vendor.phone || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{vendor.email || "—"}</TableCell>
                        {editable && (
                          <TableCell className="text-right">
                            <VendorEditDialog
                              vendor={vendor}
                              trigger={
                                <Button variant="outline" size="sm">
                                  Edit
                                </Button>
                              }
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
