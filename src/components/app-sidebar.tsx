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
 * these (Overview, Projects, Documents, Reports) — the rest are Phase 2/3/4 modules
 * per plan.md section 2, so they render disabled/"Soon" rather than linking
 * to pages that don't exist yet. This keeps the nav visually identical to
 * the wireframe pack without faking screens with no data behind them.
 */
const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Lifecycle", href: null },
  { label: "Actions", href: null },
  { label: "Documents", href: "/documents" },
  { label: "Payments", href: null },
  { label: "Projects", href: "/projects" },
  { label: "People", href: null },
  { label: "Culinary", href: null },
  { label: "Marketing", href: null },
  { label: "Reports", href: "/audit" },
];

export function AppSidebar({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-[#0b1220]">
      <div className="px-5 pt-6 pb-5">
        <div className="text-lg leading-tight font-bold tracking-tight text-white">
          FRATERNITI
        </div>
        <div className="text-lg leading-tight font-bold tracking-tight text-white">ONE</div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) => {
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

      <div className="border-t border-white/10 px-6 py-4">
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
