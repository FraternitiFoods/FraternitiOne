import type { ComponentProps } from "react";
import { cn } from "cn";

/**
 * White rounded surface used by every redesigned onboarding page (Option B).
 * `tone="dark"` is the deep-green variant (Next steps / Next action).
 */
export function ObCard({
  tone = "light",
  className,
  ...props
}: ComponentProps<"section"> & { tone?: "light" | "dark" }) {
  return (
    <section
      className={cn(
        "relative min-w-0 rounded-[28px]",
        tone === "light"
          ? "bg-white shadow-[var(--ob-card-shadow)]"
          : "overflow-hidden bg-[var(--ob-green)] text-[var(--ob-cream)]",
        className
      )}
      {...props}
    />
  );
}

/** Small caps label ("NEXT STEPS", "ONBOARDING COMPLETION"). */
export function ObEyebrow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("text-xs font-bold tracking-[0.16em] text-[var(--ob-muted)] uppercase", className)}
      {...props}
    />
  );
}

/** Card heading in the display serif. */
export function ObCardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("ob-display text-[22px] font-semibold text-[var(--ob-green)]", className)} {...props} />;
}
