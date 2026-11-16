/** Streamed in immediately on navigation while the Welcome query resolves. */
export default function OnboardingWelcomeLoading() {
  return (
    <div className="animate-pulse space-y-12" aria-hidden>
      <div className="space-y-5">
        <div className="h-9 w-64 rounded-full bg-[var(--ob-track)]" />
        <div className="h-16 w-full max-w-xl rounded-xl bg-[var(--ob-track)]" />
        <div className="h-5 w-full max-w-md rounded bg-[var(--ob-track)]" />
      </div>

      <div className="flex flex-wrap items-stretch gap-6">
        <div className="aspect-[2/3] w-full max-w-[300px] rounded-[28px] bg-white shadow-[var(--ob-card-shadow)]" />
        <div className="aspect-[2/3] w-full max-w-[300px] rounded-[28px] bg-white shadow-[var(--ob-card-shadow)]" />
        <div className="min-h-[24rem] flex-1 basis-[20rem] rounded-[28px] bg-[var(--ob-green)]/90" />
      </div>
    </div>
  );
}
