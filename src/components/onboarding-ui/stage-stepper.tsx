import { Check } from "lucide-react";
import { cn } from "cn";
import { ObCard } from "./card";

/**
 * Horizontal 5-stage stepper on lg+, a plain vertical list below (so it never
 * needs horizontal scroll on a phone). `currentIndex` comes from the Progress
 * page's existing status -> pill-position logic; earlier stages are completed
 * (filled + check), later ones upcoming.
 */
export function StageStepper({
  stages,
  currentIndex,
}: {
  stages: readonly { key: string; label: string }[];
  currentIndex: number;
}) {
  return (
    <ObCard className="px-6 py-7 sm:px-9 sm:pt-8 sm:pb-7">
      <ol className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:gap-0">
        {stages.map((stage, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          const last = i === stages.length - 1;
          return (
            <li key={stage.key} aria-current={current ? "step" : undefined} className="flex items-center gap-4 lg:block">
              <div className="flex items-center gap-2.5 lg:pr-2.5">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] sm:text-sm",
                    done && "bg-[var(--ob-green)] text-[var(--ob-cream)]",
                    current &&
                      "bg-[var(--ob-saffron)] font-extrabold text-[var(--ob-green)] shadow-[0_0_0_6px_rgb(229_138_31/0.22)]",
                    !done && !current && "border-2 border-[var(--ob-green)]/25 font-bold text-[var(--ob-muted)]"
                  )}
                >
                  {done ? <Check className="size-[18px] sm:size-[15px]" strokeWidth={2.4} aria-hidden /> : i + 1}
                </div>
                {!last && (
                  <div
                    aria-hidden
                    className={cn("hidden h-0.5 flex-1 lg:block", done ? "bg-[var(--ob-green)]" : "bg-[var(--ob-green)]/15")}
                  />
                )}
              </div>
              <div className="lg:mt-3.5">
                <div
                  className={cn(
                    "text-[15px] sm:text-sm",
                    current || done ? "font-bold text-[var(--ob-green)]" : "font-semibold text-[var(--ob-muted)]"
                  )}
                >
                  {stage.label}
                  {done && <span className="sr-only"> (completed)</span>}
                </div>
                {current && <div className="mt-0.5 text-xs text-[var(--ob-muted)]">Current stage</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </ObCard>
  );
}
