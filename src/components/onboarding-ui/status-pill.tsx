import type { ReactNode } from "react";
import type { ReviewStatus, ScanStatus } from "@prisma/client";
import { cn } from "cn";

export type PillTone = "amber" | "green" | "rose";

// bg / text pairs all clear 4.5:1; the dot + the wording mean colour is never the only signal.
const TONES: Record<PillTone, { pill: string; dot: string }> = {
  amber: { pill: "bg-[#fbe6c8] text-[#7a4200]", dot: "bg-[#e58a1f]" },
  green: { pill: "bg-[#e3f1e7] text-[#1e5c3a]", dot: "bg-[#2e8b57]" },
  rose: { pill: "bg-[#fbe3e0] text-[#8a1c14]", dot: "bg-[#c0392b]" },
};

export function StatusPill({
  tone,
  size = "md",
  children,
  className,
}: {
  tone: PillTone;
  size?: "sm" | "md";
  children: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full font-bold",
        size === "md" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs",
        t.pill,
        className
      )}
    >
      <span aria-hidden className={cn("rounded-full", size === "md" ? "size-2" : "size-1.5", t.dot)} />
      {children}
    </span>
  );
}

/** MISSING / SUBMITTED = still pending (amber); ACCEPTED = done (green); CHANGES_REQUESTED = needs action (rose). */
export function reviewStatusTone(status: ReviewStatus): PillTone {
  switch (status) {
    case "ACCEPTED":
      return "green";
    case "CHANGES_REQUESTED":
      return "rose";
    case "MISSING":
    case "SUBMITTED":
      return "amber";
  }
}

export function scanStatusTone(status: ScanStatus): PillTone {
  switch (status) {
    case "CLEAN":
      return "green";
    case "PENDING":
      return "amber";
    default:
      return "rose";
  }
}
