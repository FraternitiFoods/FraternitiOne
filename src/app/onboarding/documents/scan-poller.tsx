"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The malware scan runs in `after()` once an upload's response is already sent
 * (documents/actions.ts), so a file is still "Scanning…" when the page
 * refreshes right after the upload. Nothing else would ever update the badge
 * until the franchisee reloads, so while any file is pending re-fetch the page
 * every 2s (server component refresh — no full reload, no flicker), for at
 * most ~1 minute.
 */
export function ScanPoller({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 30) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [pending, router]);
  return null;
}
