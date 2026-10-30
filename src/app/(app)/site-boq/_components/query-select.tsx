"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * A plain native <select> that navigates by updating one query param on
 * change (e.g. `?site=...`), preserving every other param already on the
 * URL. Used for the site/category pickers on Site view and Items & Qty —
 * no form library needed since there's nothing to submit, only to navigate.
 */
export function QuerySelect({
  paramName,
  value,
  options,
  ariaLabel,
}: {
  paramName: string;
  value: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramName, event.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
