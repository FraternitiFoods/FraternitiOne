"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Home, LogOut, PenLine, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { logout } from "@/app/(auth)/login/actions";

/**
 * plan.md section 17: "Franchisee (sidebar exactly as wireframes 01-07:
 * Overview, KYC & documents, Payment, LOI & e-sign, Help)" — a different,
 * narrower sidebar than AppSidebar (the internal-staff one). Payment doesn't
 * get its own page (receipts are uploaded from the documents page, same as
 * KYC files) — flagged as a simplification from the literal wireframe list.
 *
 * Look: cream "Tulsi Warm" sidebar (design-reference/B-*.dc.html), styled with
 * the `.ob-theme` tokens from globals.css.
 *
 * Responsive by construction (not an afterthought — SRD: "same actions on
 * mobile"): a fixed left column on sm+ screens (width = --ob-sidebar-w in
 * globals.css, 238px on desktop), a sticky top bar with a
 * horizontally-scrollable nav below sm. A fixed column with no mobile variant
 * would overlap page content on a phone viewport — this mirrors the /m shell's
 * own mobile-first approach (plan.md section 16) rather than reusing
 * AppSidebar's desktop-only shape.
 */
const NAV_ITEMS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Welcome", href: "/onboarding/welcome", icon: Home },
  { label: "Progress", href: "/onboarding", icon: BarChart3 },
  { label: "KYC & Documents", href: "/onboarding/documents", icon: FileText },
  { label: "LOI & E-Sign", href: "/onboarding/loi", icon: PenLine },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : (parts[0]![1] ?? "");
  return (first + last).toUpperCase();
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div
        className={cn(
          "leading-[1.1] font-extrabold tracking-[0.02em] text-[var(--ob-green)]",
          compact ? "text-base" : "text-2xl"
        )}
      >
        FRATERNITI{compact ? " " : <br />}
        <span className="text-[#a65a00]">ONE</span>
      </div>
      <div
        className={cn(
          "font-semibold tracking-[0.18em] text-[var(--ob-muted)] uppercase",
          compact ? "mt-0.5 text-[10px]" : "mt-2.5 text-xs"
        )}
      >
        Franchisee Portal
      </div>
    </div>
  );
}

function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={logout}>
      <button
        type="submit"
        className={cn(
          "ob-focus flex items-center gap-2.5 rounded-lg text-sm font-medium text-[var(--ob-nav)] transition-colors hover:text-[var(--ob-green)]",
          className
        )}
      >
        <LogOut className="size-[18px] sm:size-[16px]" aria-hidden />
        Sign out
      </button>
    </form>
  );
}

export function OnboardingSidebar({ name, code }: { name: string; code: string | null }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: fixed left column. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--ob-sidebar-w)] flex-col gap-9 overflow-y-auto border-r border-[var(--ob-line)] bg-[var(--ob-sidebar)] px-6 pt-9 pb-7 sm:flex">
        <div className="px-2">
          <Wordmark />
        </div>

        <nav aria-label="Onboarding" className="flex flex-col gap-1.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "ob-focus flex h-12 items-center gap-3.5 rounded-xl px-4 text-sm transition-colors",
                  active
                    ? "bg-[var(--ob-green)] font-semibold text-[var(--ob-cream)]"
                    : "font-medium text-[var(--ob-nav)] hover:bg-[var(--ob-green)]/8"
                )}
              >
                <Icon className={cn("size-5", active && "text-[var(--ob-saffron)]")} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5 border-t border-[var(--ob-green)]/15 pt-6">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-[var(--ob-green)] text-xs font-bold text-[var(--ob-cream)]"
            >
              {initials(name)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[var(--ob-green)]">{name}</div>
              {code && <div className="text-xs text-[var(--ob-muted)]">{code}</div>}
            </div>
          </div>
          <SignOutButton className="h-11 px-1" />
        </div>
      </aside>

      {/* Mobile: sticky top bar, horizontally scrollable nav. */}
      <header className="sticky top-0 z-40 flex flex-col gap-2 border-b border-[var(--ob-line)] bg-[var(--ob-sidebar)] px-4 py-3 sm:hidden">
        <div className="flex items-center justify-between">
          <Wordmark compact />
          <SignOutButton className="h-9 px-2" />
        </div>
        <nav aria-label="Onboarding" className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "ob-focus flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-xs whitespace-nowrap transition-colors",
                  active
                    ? "bg-[var(--ob-green)] font-semibold text-[var(--ob-cream)]"
                    : "font-medium text-[var(--ob-nav)] hover:bg-[var(--ob-green)]/8"
                )}
              >
                <Icon className={cn("size-4", active && "text-[var(--ob-saffron)]")} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
