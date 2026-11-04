"use client";

import { useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
      <TriangleAlertIcon className="size-8 text-destructive" />
      <h2 className="text-sm font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page hit an unexpected error.
        {error.digest && <> Error reference: <span className="font-mono">{error.digest}</span>.</>}
      </p>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
