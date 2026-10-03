import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { SALES_CSV_TEMPLATE } from "@/lib/sales/parse-csv";

/**
 * plan.md section 20A — "Download template" link on /sales/import. Our own
 * layout (date,gross_sales,net_sales,orders), not a real POS export — see
 * the module comment on SALES_CSV_TEMPLATE for the "unconfirmed" caveat.
 * Any authenticated user can fetch it; there's nothing sensitive in a blank
 * template, but it's still behind requireUser() rather than fully public.
 */
export async function GET() {
  await requireUser();
  return new NextResponse(SALES_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sales-template.csv"',
    },
  });
}
