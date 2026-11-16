"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MessageCircle } from "lucide-react";
import { cn } from "cn";

/**
 * Wraps the portal's <main> and hosts the assistant. ONE look and ONE behaviour
 * everywhere: a card at the bottom-right (nearly full screen on phones) that is
 * closed on arrival on every page — Welcome included — and opened only when the
 * franchisee taps the floating "Ask assistant" button. It floats over the page;
 * the page never reserves room for it.
 *
 * The panel is mounted the first time it is opened and then only hidden, so the
 * conversation survives closing/reopening and page changes (this layout never
 * unmounts while the franchisee moves between portal pages). Its code is
 * lazy-loaded (next/dynamic), so it can never delay the page's first paint, and
 * nobody downloads it unless they ask for it.
 */
const ChatPanel = dynamic(() => import("./chat-panel"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-muted/40" aria-hidden />,
});

export function ChatShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <main className="relative min-h-screen overflow-x-clip px-4 py-4 sm:pt-12 sm:pr-10 sm:pb-28 sm:pl-[19.5rem]">
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
          <ChatPanel onClose={() => setOpen(false)} />
        </aside>
      )}

      <button
        type="button"
        onClick={() => {
          setMounted(true); // first open downloads + mounts the panel; after that it is only hidden
          setOpen(true);
        }}
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
