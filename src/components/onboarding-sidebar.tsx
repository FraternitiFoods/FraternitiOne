"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { logout } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";

/**
 * plan.md section 17: "Franchisee (sidebar exactly as wireframes 01-07:
 * Overview, KYC & documents, Payment, LOI & e-sign, Help)" — a different,
 * narrower sidebar than AppSidebar (the internal-staff one). Payment doesn't
 * get its own page (receipts are uploaded from the documents page, same as
 * KYC files) — flagged as a simplification from the literal wireframe list.
 *
 * Responsive by construction (not an afterthought — SRD: "same actions on
 * mobile"): a fixed left column on sm+ screens, a horizontally-scrollable
 * sticky top bar below sm. A fixed w-56 column with no mobile variant (the
 * naive version of this component) would overlap page content on a phone
 * viewport — this mirrors the /m shell's own mobile-first approach
 * (plan.md section 16) rather than reusing AppSidebar's desktop-only shape.
 */
const NAV_ITEMS = [
  { label: "Overview", href: "/onboarding" },
  { label: "KYC & Documents", href: "/onboarding/documents" },
  { label: "LOI & E-Sign", href: "/onboarding/loi" },
];

export function OnboardingSidebar({ name }: { name: string }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: fixed left column. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col bg-[#0b1220] sm:flex">
        <div className="px-5 pt-6 pb-5">
          <div className="text-lg leading-tight font-bold tracking-tight text-white">FRATERNITI</div>
          <div className="text-lg leading-tight font-bold tracking-tight text-white">ONE</div>
          <div className="mt-1 text-[10px] tracking-wide text-slate-500 uppercase">Franchisee Portal</div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "block rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="truncate text-sm font-medium text-white">{name}</div>
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

      {/* Mobile: sticky top bar, horizontally scrollable nav. */}
      <header className="sticky top-0 z-40 flex flex-col gap-2 border-b bg-[#0b1220] px-4 py-3 sm:hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold tracking-tight text-white">FRATERNITI ONE</div>
            <div className="text-[10px] tracking-wide text-slate-500 uppercase">Franchisee Portal</div>
          </div>
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-slate-400 hover:bg-white/5 hover:text-white"
            >
              Sign out
            </Button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
                  active ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
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
