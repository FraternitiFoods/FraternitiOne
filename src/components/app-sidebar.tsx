"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { logout } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

type NavItem = { label: string; href: string | null };

/**
 * Fixed nav list, in the exact order shown in every SRD wireframe's left
 * sidebar (wireframes 01-24). Phase 1 only has real pages for a handful of
 * these (Overview, Actions, Projects, Documents, Reports) — the rest are
 * Phase 2/3/4 modules per plan.md section 2, so they render disabled/"Soon"
 * rather than linking to pages that don't exist yet. This keeps the nav
 * visually identical to the wireframe pack without faking screens with no
 * data behind them.
 */
const BASE_NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Lifecycle", href: null },
  { label: "Actions", href: "/actions" },
  { label: "Documents", href: "/documents" },
  { label: "Payments", href: null },
  { label: "Projects", href: "/projects" },
  // Not part of the original SRD wireframe pack — added alongside the BOQ/Ops
  // category rollup itself (plan.md section 9) so it's reachable without
  // drilling into a specific project's Overview section first. Split into two
  // screens (2026-09-23): BOQ (Excel-sourced trade line items) and
  // Construction & Ops Progress (process checklists never in that Excel) —
  // see ops-route.ts.
  { label: "BOQ", href: "/boq" },
  { label: "Operations", href: "/construction-ops" },
  // plan.md section 17 — visible to every onboarding-touching role (Sales,
  // Admin, KYC Reviewer, Accounts, LOI Preparer, Company Signatory); the page
  // itself re-checks with the real permission functions (permissions.ts is
  // server-only, so this sidebar — a Client Component — can't import it
  // directly, same reasoning as the People/Admin-only link below).
  { label: "Store Onboarding", href: "/store-onboarding" },
  { label: "Reviews", href: "/reviews" },
  { label: "Signing", href: "/signing" },
  { label: "People", href: null },
  { label: "Culinary", href: null },
  { label: "Marketing", href: null },
  { label: "Reports", href: "/audit" },
];

export function AppSidebar({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  // plan.md section 17 — every role with an onboarding-related permission
  // function in permissions.ts (mirrored here since that file is
  // server-only and can't be imported into a Client Component).
  const ONBOARDING_ROLES: Role[] = [
    "SALES",
    "ADMIN",
    "KYC_REVIEWER",
    "ACCOUNTS",
    "LOI_PREPARER",
    "COMPANY_SIGNATORY",
  ];

  // "People" only has a real page for Admin (canManageUsers, permissions.ts)
  // — every other role keeps seeing it as the "Soon" placeholder like the
  // rest of the not-yet-built Phase 2/3/4 modules. "Store Onboarding" is
  // hidden entirely (not "Soon") for roles with no stake in it — Franchisee
  // uses their own /onboarding portal instead (different sidebar).
  const ONBOARDING_NAV_LABELS = ["Store Onboarding", "Reviews", "Signing"];
  const navItems = BASE_NAV_ITEMS.filter(
    (item) => !ONBOARDING_NAV_LABELS.includes(item.label) || ONBOARDING_ROLES.includes(role)
  )
    .map((item) => (item.label === "People" && role === "ADMIN" ? { ...item, href: "/users" } : item))
    .concat(
      role === "ADMIN"
        ? [
            { label: "E-sign Events", href: "/admin/esign-events" },
            { label: "Email Templates", href: "/admin/email-templates" },
          ]
        : []
    );

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-hidden bg-[#0b1220]">
      <div className="shrink-0 px-5 pt-6 pb-5">
        <div className="text-lg leading-tight font-bold tracking-tight text-white">
          FRATERNITI
        </div>
        <div className="text-lg leading-tight font-bold tracking-tight text-white">ONE</div>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
        {navItems.map((item) => {
          if (!item.href) {
            return (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600"
                title="Coming in a later phase"
              >
                <span>{item.label}</span>
                <span className="text-[10px] tracking-wide text-slate-700 uppercase">Soon</span>
              </div>
            );
          }

          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "block rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-white/10 font-medium text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-6 py-4">
        <div className="truncate text-sm font-medium text-white">{name}</div>
        <div className="text-xs text-slate-500">{ROLE_LABELS[role]}</div>
        <form action={logout} className="mt-2">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-0 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}
