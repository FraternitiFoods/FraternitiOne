import { ArrowRight, Check } from "lucide-react";
import { cn } from "cn";
import type { JourneyStepState } from "@/lib/onboarding/welcome-steps";
import { ObCard } from "./card";
import { LeafWatermark } from "./decor";
import { ObLinkButton } from "./buttons";

export type JourneyItem = { key: string; title: string; state: JourneyStepState; caption?: string };

/** Dark-green "Next steps" card: existing next-action text, derived 3-step timeline, one CTA. */
export function NextStepsCard({
  message,
  steps,
  action,
}: {
  message: string;
  steps: JourneyItem[];
  action: { href: string; label: string };
}) {
  return (
    <ObCard tone="dark" className="flex min-w-0 flex-1 basis-[20rem] flex-col p-7 sm:basis-[17rem] sm:p-9">
      <LeafWatermark className="-right-12 -bottom-12 size-[260px] sm:size-[220px]" />

      <div className="relative text-xs font-bold tracking-[0.16em] text-[var(--ob-saffron)] uppercase">Next steps</div>
      <p className="ob-display relative mt-3.5 text-2xl leading-[1.3] font-medium">{message}</p>

      <ol className="relative mt-7 flex flex-col">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          const { state } = step;
          return (
            <li key={step.key} aria-current={state === "current" ? "step" : undefined} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    state === "done" && "bg-[var(--ob-saffron)] text-[var(--ob-green)]",
                    state === "current" && "border-2 border-[var(--ob-saffron)] text-[var(--ob-saffron)]",
                    state === "upcoming" && "border-2 border-[var(--ob-cream)]/35 text-[var(--ob-on-green-sub)]"
                  )}
                >
                  {state === "done" ? <Check className="size-[18px] sm:size-[15px]" strokeWidth={2.4} aria-hidden /> : i + 1}
                </div>
                {!last && (
                  <div
                    aria-hidden
                    className={cn(
                      "my-1.5 min-h-4 w-0.5 flex-1",
                      state === "done" ? "bg-[var(--ob-saffron)]" : "bg-[var(--ob-cream)]/25"
                    )}
                  />
                )}
              </div>
              <div className={cn("pt-1.5", !last && "pb-4")}>
                <div className="text-[15px] font-bold sm:text-sm">
                  {step.title}
                  {state === "done" && <span className="sr-only"> (done)</span>}
                </div>
                {step.caption && <div className="mt-0.5 text-xs text-[var(--ob-on-green-sub)]">{step.caption}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="relative mt-auto pt-8">
        <ObLinkButton href={action.href} variant="saffron" size="lg" className="w-full gap-2.5">
          {action.label}
          <ArrowRight className="size-[18px] sm:size-[16px]" strokeWidth={2.2} aria-hidden />
        </ObLinkButton>
      </div>
    </ObCard>
  );
}
