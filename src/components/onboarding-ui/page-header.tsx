import type { ReactNode } from "react";
import { LeafIcon } from "./decor";

/** White pill above each page title: leaf in a green dot + "{franchise ID} · {outlet}". */
export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-[var(--ob-green)]/15 bg-white py-2 pr-[18px] pl-2.5 text-sm font-semibold text-[var(--ob-green)]">
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--ob-green)] text-[var(--ob-cream)]">
        <LeafIcon className="size-3.5" />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
