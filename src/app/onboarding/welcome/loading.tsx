import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Streamed in immediately on navigation while the Welcome query resolves. */
export default function OnboardingWelcomeLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-2">
        <div className="h-6 w-64 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
      </div>

      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="mx-auto aspect-[9/16] w-full max-w-[17rem] rounded-xl bg-muted" />
          <div className="mx-auto aspect-[9/16] w-full max-w-[17rem] rounded-xl bg-muted sm:mt-10" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="h-4 w-24 rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 w-72 rounded bg-muted" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="size-6 rounded-full bg-muted" />
              <div className="h-4 w-80 max-w-full rounded bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
