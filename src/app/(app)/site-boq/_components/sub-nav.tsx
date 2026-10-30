import Link from "next/link";
import { cn } from "cn";

/**
 * plan.md section 4: "all under /site-boq, top sub-navigation." Purchase
 * Orders has no route yet (milestone M6) — kept as a disabled label so the
 * tab order matches the plan even before it's clickable.
 */
const TABS = [
  { key: "overview", label: "Overview", href: "/site-boq" },
  { key: "site-view", label: "Site view", href: "/site-boq/site-view" },
  { key: "items", label: "Items & Qty", href: "/site-boq/items" },
  { key: "vendors", label: "Vendors", href: "/site-boq/vendors" },
  { key: "purchase-orders", label: "Purchase Orders", href: null },
  { key: "sites", label: "Sites", href: "/site-boq/sites" },
  { key: "settings", label: "Settings", href: "/site-boq/settings" },
] as const;

export type SiteBoqTabKey = (typeof TABS)[number]["key"];

export function SiteBoqSubNav({ active }: { active: SiteBoqTabKey }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-foreground/10 pb-2">
      {TABS.map((tab) =>
        tab.href ? (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              tab.key === active
                ? "bg-foreground/10 font-medium text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.key}
            aria-disabled="true"
            title="Coming soon"
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground/50"
          >
            {tab.label}
          </span>
        )
      )}
    </div>
  );
}
