/**
 * Streamed in immediately on navigation while the complaint list query
 * resolves. Uses plain placeholders instead of PageHeader — loading.tsx
 * can't know the user's role (isFranchisee) without its own session check,
 * which would defeat the point of a fast fallback.
 */
export default function ComplaintsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-32 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 w-72 max-w-sm rounded-md bg-muted" />
        <div className="h-9 w-36 rounded-md bg-muted" />
        <div className="h-9 w-32 rounded-md bg-muted" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 w-full rounded-xl bg-muted ring-1 ring-foreground/10" />
        ))}
      </div>
    </div>
  );
}
