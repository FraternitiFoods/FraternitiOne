import { Badge } from "@/components/ui/badge";

/** plan.md section 3: "locked sites show a lock badge everywhere the site appears." Shared so the 4 screens can't drift in style. */
export function SiteLockBadge({ locked, className }: { locked: boolean; className?: string }) {
  if (!locked) return null;
  return (
    <Badge variant="outline" className={className ?? "ml-2 align-middle"}>
      Locked
    </Badge>
  );
}
