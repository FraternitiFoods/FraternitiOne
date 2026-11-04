"use client";

import { useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootError({
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlertIcon className="size-8 text-destructive" />
      <h2 className="text-sm font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        The app hit an unexpected error.
        {error.digest && <> Error reference: <span className="font-mono">{error.digest}</span>.</>}
      </p>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
