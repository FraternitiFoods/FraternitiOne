import { ObCard } from "@/components/onboarding-ui/card";

/** Streamed in immediately on navigation while the KYC/payment query resolves. */
export default function OnboardingDocumentsLoading() {
  return (
    <div className="animate-pulse space-y-9" aria-hidden>
      <div className="space-y-3">
        <div className="h-12 w-80 max-w-full rounded-xl sm:h-14 bg-[var(--ob-track)]" />
        <div className="h-5 w-72 max-w-full rounded bg-[var(--ob-track)]" />
      </div>

      <ObCard className="space-y-3 p-8">
        <div className="h-8 w-24 rounded bg-[var(--ob-track)]" />
        <div className="h-20 rounded-[20px] bg-[var(--ob-bg)] sm:rounded-[17px]" />
        <div className="h-20 rounded-[20px] bg-[var(--ob-bg)] sm:rounded-[17px]" />
      </ObCard>

      <ObCard className="h-48" />
    </div>
  );
}
