import type { ReactNode } from "react";
import { cn } from "cn";

/** Small metric tile used across the dashboard/portfolio views (SRD wireframes' stat-card rows). */
export function StatCard({
  label,
  value,
  caption,
  captionClassName,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  captionClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}>
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {caption && (
        <div className={cn("mt-1 text-xs text-muted-foreground", captionClassName)}>
          {caption}
        </div>
      )}
    </div>
  );
}
