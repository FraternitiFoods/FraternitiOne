import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Streamed in immediately on navigation while the KYC/payment query resolves. */
export default function OnboardingDocumentsLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-5 w-24 rounded-full bg-muted" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted" />
          <div className="h-9 w-40 rounded bg-muted" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-5 w-24 rounded-full bg-muted" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-9 w-40 rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}
