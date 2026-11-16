import { ObCard } from "@/components/onboarding-ui/card";

/** Streamed in immediately on navigation while the onboarding overview query resolves. */
export default function OnboardingHomeLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      <div className="space-y-3">
        <div className="h-9 w-28 rounded-full bg-[var(--ob-track)]" />
        <div className="h-12 w-72 max-w-full rounded-xl bg-[var(--ob-track)]" />
        <div className="h-5 w-44 rounded bg-[var(--ob-track)]" />
      </div>

      <ObCard className="h-28" />
      <div className="h-32 rounded-[28px] bg-[var(--ob-green)]/90" />

      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <ObCard key={i} className="h-40" />
        ))}
      </div>

      <ObCard className="h-28" />
    </div>
  );
}
