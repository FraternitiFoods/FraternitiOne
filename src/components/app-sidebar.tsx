"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { ChevronsUpDown } from "lucide-react";
import { logout } from "@/app/(auth)/login/actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/format";
import { canSeeModule, type AppModule } from "@/lib/role-access";
import type { Role } from "@prisma/client";

type NavItem = { label: string; href: string | null; module: AppModule };

/**
 * 5 items (plan.md section 2, extended by section 13 with Store Onboarding). All live. (The "Coming soon"
 * rendering below stays for any future item added with `href: null`.) Which
 * ones a role sees is decided by `canSeeModule` (src/lib/role-access.ts,
 * plan.md section 12) — the same sets the server-side permission checks use,
 * so the menu can't disagree with the 403s. Dashboard is visible to every
 * role including franchisees: a franchisee is routed to their own assigned
 * site (see src/app/(app)/dashboard/page.tsx). A hidden module still 403s
 * server-side if its URL is typed in directly.
 */
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", module: "dashboard" },
  { label: "Site Tracker", href: "/site-tracker", module: "site-tracker" },
  { label: "Site BOQ", href: "/site-boq", module: "site-boq" },
  { label: "Operations BOQ", href: "/operations-boq", module: "operations-boq" },
  { label: "Store Onboarding", href: "/store-onboarding", module: "store-onboarding" },
];

/**
 * Admin-only links live here, not in the main nav: "Manage users", plus the
 * onboarding admin pages ("E-sign events", "Email templates" — plan.md
 * section 13). Everyone else only ever sees "Sign out".
 */
function AccountMenuItems({ role }: { role: Role }) {
  return (
    <>
      {role === "ADMIN" && (
        <>
          <DropdownMenuLinkItem render={<Link href="/users" />}>Manage users</DropdownMenuLinkItem>
          <DropdownMenuLinkItem render={<Link href="/admin/esign-events" />}>E-sign events</DropdownMenuLinkItem>
          <DropdownMenuLinkItem render={<Link href="/admin/email-templates" />}>Email templates</DropdownMenuLinkItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
        Sign out
      </DropdownMenuItem>
    </>
  );
}

export function AppSidebar({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  const navItems = NAV_ITEMS.filter((item) => canSeeModule(role, item.module));

  return (
    <>
      {/* Desktop: fixed left column. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col overflow-hidden bg-[#0b1220] sm:flex">
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
                  aria-disabled="true"
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600"
                  title="Coming soon"
                >
                  <span>{item.label}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] tracking-wide text-slate-500 uppercase">
                    Coming soon
                  </span>
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

        <div className="shrink-0 border-t border-white/10 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white">{name}</span>
                <span className="block text-xs text-slate-500">{ROLE_LABELS[role]}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-500" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <AccountMenuItems role={role} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Mobile: sticky top bar, horizontally scrollable nav. */}
      <header className="sticky top-0 z-40 flex flex-col gap-2 border-b bg-[#0b1220] px-4 py-3 sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-white">FRATERNITI ONE</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-right hover:bg-white/5">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-white">{name}</span>
                <span className="block text-[10px] text-slate-500">{ROLE_LABELS[role]}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-slate-500" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-56">
              <AccountMenuItems role={role} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
          {navItems.map((item) => {
            if (!item.href) {
              return (
                <div
                  key={item.label}
                  aria-disabled="true"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap text-slate-600"
                  title="Coming soon"
                >
                  {item.label} <span className="text-[9px] text-slate-700 uppercase">Soon</span>
                </div>
              );
            }

            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
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
      </header>
    </>
  );
}
