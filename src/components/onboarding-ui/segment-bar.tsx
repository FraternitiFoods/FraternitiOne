import { cn } from "cn";

/** N equal segments, the first `filled` in saffron. Decorative: the count is always also shown as text. */
export function SegmentBar({ total, filled }: { total: number; filled: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn("h-2 flex-1 rounded-full", i < filled ? "bg-[var(--ob-saffron)]" : "bg-[var(--ob-track)]")}
        />
      ))}
    </div>
  );
}
