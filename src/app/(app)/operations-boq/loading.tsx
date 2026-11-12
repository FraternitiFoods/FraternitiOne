import { Loader2Icon } from "lucide-react";

export default function OperationsBoqLoading() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl bg-card p-8 text-sm text-muted-foreground ring-1 ring-foreground/10">
      <Loader2Icon className="size-4 animate-spin" />
      Loading…
    </div>
  );
}
