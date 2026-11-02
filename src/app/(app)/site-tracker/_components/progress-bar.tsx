import { cn } from "cn";

/** Plain div bar — no new UI primitive for one simple case (matches this app's existing "native element over a new abstraction" convention). */
export function ProgressBar({ percent, className, barClassName }: { percent: number; className?: string; barClassName?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full bg-primary transition-[width]", barClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
