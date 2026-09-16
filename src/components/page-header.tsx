import type { ReactNode } from "react";
import { PortalBadge } from "@/components/portal-badge";

/** Page title + subtitle + portal badge row, reused on every top-level page. */
export function PageHeader({
  title,
  subtitle,
  isFranchisee,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  isFranchisee: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {action}
        <PortalBadge isFranchisee={isFranchisee} />
      </div>
    </div>
  );
}
