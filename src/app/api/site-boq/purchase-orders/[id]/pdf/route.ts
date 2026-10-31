import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { canCreatePo } from "@/lib/permissions";
import { getPurchaseOrderById } from "@/lib/boq-data";
import { decToNumber } from "@/lib/boq-calc";
import { generatePurchaseOrderPdf, type PoPdfCompany, type PoPdfVendor, type PoPdfSite } from "@/lib/po-pdf";

/**
 * plan.md section 4.5 "Download PDF" — regenerates the PDF on every request
 * from the PurchaseOrder's own stored snapshots (never from live
 * Vendor/Site/Settings rows), so a re-download always matches what was true
 * when the PO was created even if those rows have since changed.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/site-boq/purchase-orders/[id]/pdf">) {
  const user = await requireUser();
  if (!canCreatePo(user)) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }

  const { id } = await params;
  const po = await getPurchaseOrderById(id);
  if (!po) {
    return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  }

  const company = po.companySnapshot as unknown as PoPdfCompany;
  const vendor = po.vendorSnapshot as unknown as PoPdfVendor;
  const site = po.siteSnapshot as unknown as PoPdfSite;
  const terms = (po.termsSnapshot as unknown as { poTerms?: string[] }).poTerms ?? [];

  const pdfBytes = await generatePurchaseOrderPdf({
    poNumber: po.poNumber,
    poDate: po.poDate,
    deliveryBy: po.deliveryBy,
    deliveryDays: po.deliveryDays,
    paymentTerms: po.paymentTerms,
    gstPercent: decToNumber(po.gstPercent) ?? 0,
    subtotal: decToNumber(po.subtotal) ?? 0,
    gstAmount: decToNumber(po.gstAmount) ?? 0,
    total: decToNumber(po.total) ?? 0,
    company,
    vendor,
    site,
    categoryName: po.category.displayName,
    terms,
    lines: po.lines.map((line) => ({
      nameSnapshot: line.nameSnapshot,
      remarkSize: line.remarkSize,
      qty: decToNumber(line.qty) ?? 0,
      rate: decToNumber(line.rate) ?? 0,
      amount: decToNumber(line.amount) ?? 0,
      photoStorageKey: line.photoStorageKey,
    })),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.poNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf"`,
    },
  });
}
