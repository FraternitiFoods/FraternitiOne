import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";

/**
 * Sub-navigation placeholder (plan.md section 4) — none of these screens
 * exist yet (M1+ builds them out one at a time). "Overview" is shown active
 * since it'll be the default landing tab once it's real.
 */
const SUB_NAV_LABELS = [
  "Overview",
  "Site view",
  "Items & Qty",
  "Vendors",
  "Purchase Orders",
  "Sites",
  "Settings",
];

export default async function SiteBoqPage() {
  const user = await requireUser();

  // Site BOQ is internal-only (plan.md section 2) — an external/franchisee
  // role must get 403 here and on every /site-boq/* and /api/boq/* route.
  if (user.role === "FRANCHISEE") {
    forbidden();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Site BOQ" subtitle="Rate sheet, quantities and purchase orders." isFranchisee={false} />

      <div className="flex flex-wrap gap-1 border-b border-foreground/10 pb-2">
        {SUB_NAV_LABELS.map((label, i) => (
          <span
            key={label}
            className={
              i === 0
                ? "rounded-lg bg-foreground/10 px-3 py-1.5 text-sm font-medium"
                : "rounded-lg px-3 py-1.5 text-sm text-muted-foreground"
            }
          >
            {label}
          </span>
        ))}
      </div>

      <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        Site BOQ is being built out — screens land here milestone by milestone.
      </div>
    </div>
  );
}
