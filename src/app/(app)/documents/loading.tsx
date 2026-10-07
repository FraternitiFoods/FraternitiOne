/**
 * Streamed in immediately on navigation while the document vault query
 * resolves. Uses plain placeholders instead of PageHeader — loading.tsx
 * can't know the user's role (isFranchisee) without its own session check,
 * which would defeat the point of a fast fallback.
 */
export default function DocumentsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded bg-muted" />
          <div className="h-4 w-80 rounded bg-muted" />
        </div>
      </div>

      <div className="h-9 w-72 rounded-md bg-muted" />

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="border-b p-4">
              <div className="h-4 w-32 rounded bg-muted" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="h-5 w-full rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
