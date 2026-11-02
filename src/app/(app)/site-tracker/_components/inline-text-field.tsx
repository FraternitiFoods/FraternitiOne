"use client";

import { cn } from "cn";

/**
 * Uncontrolled input (same convention as Site BOQ's qty-cell/remark-cell):
 * saves on blur, only when the value actually changed. `key={value}` forces
 * a remount — resetting the field's text — whenever the parent's own value
 * changes from outside a direct edit here (e.g. reverted after a failed
 * save), without a useEffect+setState sync loop.
 */
export function InlineTextField({
  value,
  placeholder,
  disabled,
  className,
  onSave,
}: {
  value: string | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSave: (value: string | null) => void;
}) {
  return (
    <input
      key={value ?? ""}
      type="text"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={(e) => {
        const trimmed = e.target.value.trim();
        if (trimmed !== (value ?? "")) onSave(trimmed || null);
      }}
      className={cn(
        "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  );
}
