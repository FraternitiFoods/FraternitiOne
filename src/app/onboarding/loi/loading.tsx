import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Streamed in immediately on navigation while the LOI/e-sign query resolves. */
export default function OnboardingLoiLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-6 w-36 rounded bg-muted" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-5 w-24 rounded-full bg-muted" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
          <div className="h-9 w-32 rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}
