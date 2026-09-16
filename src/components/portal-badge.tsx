import { cn } from "cn";

/**
 * Top-right corner pill on every wireframe screen ("FRANCHISEE PORTAL" /
 * "INTERNAL") — a quick visual reminder of whose view this is, matching the
 * SRD wireframe pack exactly (wireframes 01-18 show the franchisee-facing
 * variant, 19-24 the internal one).
 */
export function PortalBadge({
  isFranchisee,
  className,
}: {
  isFranchisee: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-3 text-[11px] font-semibold tracking-wide uppercase",
        isFranchisee ? "bg-violet-100 text-violet-700" : "bg-slate-900 text-white",
        className
      )}
    >
      {isFranchisee ? "Franchisee Portal" : "Internal"}
    </span>
  );
}
