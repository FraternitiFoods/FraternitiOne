export default function Forbidden() {
  return (
    <div className="rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
      <h1 className="text-lg font-semibold">403 — Forbidden</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Site BOQ is an internal-only module. Your account doesn&apos;t have access to it.
      </p>
    </div>
  );
}
