"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { cn } from "cn";
import { ONBOARDING_WELCOME_PATH } from "@/lib/role-access";

/**
 * Wraps the portal's <main> and hosts the assistant. ONE look everywhere: a
 * card at the bottom-right (nearly full screen on phones) opened from a
 * floating button, same size on every portal page.
 *
 * The only difference on the Welcome page: on wide screens (1280px+) the card is
 * already open when you arrive, and the page reserves room for it so nothing is
 * covered. The franchisee can close it; once they have opened or closed it
 * themselves that choice sticks on every page. (Below xl it stays closed on
 * arrival: a card that size would cover the page.)
 *
 * The panel is mounted the first time it is shown and then only hidden, so the
 * conversation survives closing/reopening and page changes (this layout never
 * unmounts while the franchisee moves between portal pages). Its code is
 * lazy-loaded (next/dynamic), so it can never delay the page's first paint.
 */
const XL_QUERY = "(min-width: 1280px)"; // Tailwind `xl`
function subscribeXl(onChange: () => void) {
  const mq = window.matchMedia(XL_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const ChatPanel = dynamic(() => import("./chat-panel"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-muted/40" aria-hidden />,
});

export function ChatShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onWelcome = pathname === ONBOARDING_WELCOME_PATH;

  // null = franchisee hasn't chosen yet: Welcome opens it (xl+ only), other pages leave it closed.
  const [choice, setChoice] = useState<"open" | "closed" | null>(null);
  const [mounted, setMounted] = useState(false);

  const isXl = useSyncExternalStore(subscribeXl, () => window.matchMedia(XL_QUERY).matches, () => false);
  const autoOpen = choice === null && onWelcome && isXl;
  const open = choice === "open" || autoOpen;
  // Mount (and so download the chat code) only once the card is actually shown: a phone never auto-loads it.
  if (open && !mounted) setMounted(true);

  return (
    <>
      {/* Conditional, not merged: two right-padding utilities on one element would fight. */}
      <main className={cn("relative min-h-screen overflow-x-clip px-4 py-4 sm:pt-12 sm:pb-28 sm:pl-[19.5rem]", autoOpen ? "sm:pr-[27rem]" : "sm:pr-10")}>
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {mounted && (
        <aside
          aria-label="Assistant"
          className={cn(
            "fixed z-50 overflow-hidden rounded-3xl bg-card shadow-xl ring-1 ring-[var(--ob-green)]/15",
            "inset-x-2 top-16 bottom-2 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:h-[34rem] sm:w-[24rem]",
            open ? "flex flex-col" : "hidden"
          )}
        >
          <ChatPanel onClose={() => setChoice("closed")} />
        </aside>
      )}

      <button
        type="button"
        onClick={() => setChoice("open")}
        aria-label="Open assistant"
        className={cn(
          "ob-focus fixed right-4 bottom-4 z-40 flex h-[52px] items-center gap-2.5 rounded-full bg-[var(--ob-green)] px-6 text-[15px] font-semibold text-[var(--ob-cream)] shadow-[0_14px_30px_-12px_rgb(15_51_36/0.6)] transition-transform hover:scale-105 sm:right-8 sm:bottom-8",
          open && "hidden"
        )}
      >
        <MessageCircle className="size-5 text-[var(--ob-saffron)]" aria-hidden />
        Ask assistant
      </button>
    </>
  );
}
