"use client";

import { useRef, useState } from "react";
import { PencilIcon } from "lucide-react";
import { cn } from "cn";

const INPUT_CLASS =
  "h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-100 disabled:hover:border-transparent dark:[color-scheme:dark]";

/**
 * One inline-editable text/money/date cell: saved on blur or Enter (Escape
 * cancels). `draft` is null while the cell isn't being edited, so what's shown
 * is always derived from the row (`display`) — an optimistic update or a revert
 * after a failed save shows up without any effect syncing local state.
 *
 * `value` is the raw editable form ("" = empty), `display` what's shown when
 * not focused (e.g. "₹3,37,866"). A date commits as soon as a full date is
 * picked (the calendar popup has no natural blur); clearing commits on blur.
 */
export function EditableCell({
  value,
  display,
  kind,
  disabled,
  onCommit,
  ariaLabel,
  placeholder,
  className,
  widthClass = "min-w-32",
}: {
  value: string;
  display: string;
  kind: "text" | "money" | "date";
  disabled: boolean;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  widthClass?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  return (
    <input
      type={kind === "date" ? "date" : "text"}
      inputMode={kind === "money" ? "decimal" : undefined}
      value={draft ?? display}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={disabled ? "-" : (placeholder ?? "-")}
      onFocus={() => setDraft(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (kind === "date" && e.target.value) onCommit(e.target.value);
      }}
      onBlur={() => {
        const next = (draft ?? value).trim();
        const wasCancelled = cancelled.current;
        cancelled.current = false;
        setDraft(null);
        if (!wasCancelled && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={cn(INPUT_CLASS, widthClass, kind === "money" && "text-right tabular-nums", className)}
    />
  );
}

/**
 * Link cell: a short "Open" link (new tab) when filled, with a pencil to edit
 * the URL; an input when empty or being edited. Read-only users just get "Open"
 * or "-". The URL rule (http/https only) is enforced by the server action too.
 */
export function LinkCell({
  value,
  disabled,
  onCommit,
  ariaLabel,
}: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);

  if (value && !editing) {
    return (
      <span className="flex min-w-24 items-center gap-1.5 px-1.5">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline-offset-4 hover:underline"
          aria-label={`Open ${ariaLabel}`}
        >
          Open
        </a>
        {!disabled && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${ariaLabel}`}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PencilIcon className="size-3" />
          </button>
        )}
      </span>
    );
  }

  if (disabled) return <span className="px-1.5 text-muted-foreground">-</span>;

  return (
    <input
      type="text"
      defaultValue={value}
      autoFocus={editing}
      aria-label={ariaLabel}
      placeholder="https://…"
      onBlur={(e) => {
        const next = e.target.value.trim();
        setEditing(false);
        // Show the saved value again right away; a successful optimistic update
        // swaps this input for the "Open" link, a failed one leaves it empty
        // rather than showing text that was never saved.
        e.target.value = value;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      className={cn(INPUT_CLASS, "min-w-32")}
    />
  );
}
