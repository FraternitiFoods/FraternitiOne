import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * A zero-JS search box: a plain GET form submitting to the current page's
 * own URL (default form action) on Enter. `preserveParams` re-adds every
 * other query param already on the URL as hidden fields, so searching
 * doesn't drop a site/category selection made via `QuerySelect`.
 */
export function SearchBox({
  paramName = "q",
  defaultValue,
  placeholder,
  preserveParams = {},
}: {
  paramName?: string;
  defaultValue: string;
  placeholder: string;
  preserveParams?: Record<string, string>;
}) {
  return (
    <form className="relative w-full max-w-xs">
      {Object.entries(preserveParams).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" name={paramName} defaultValue={defaultValue} placeholder={placeholder} className="pl-8" />
    </form>
  );
}
