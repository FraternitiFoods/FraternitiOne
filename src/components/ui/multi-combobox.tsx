"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

const DEFAULT_VISIBLE_LIMIT = 5

/**
 * Searchable multi-select combobox (string values in, string values out via
 * hidden inputs named `name` — same `formData.getAll(name)` shape as the
 * plain checkbox-list multi-selects elsewhere in this app, e.g.
 * additionalRoles). Only shows the first `visibleLimit` matches at a time,
 * with a "Show N more" row to reveal the rest — search re-filters against
 * the full `items` list regardless of that limit.
 */
function MultiCombobox({
  id,
  name,
  items,
  defaultValue,
  placeholder = "Search…",
  emptyText = "No results found.",
  visibleLimit = DEFAULT_VISIBLE_LIMIT,
  className,
}: {
  id?: string
  name: string
  items: string[]
  defaultValue?: string[]
  placeholder?: string
  emptyText?: string
  visibleLimit?: number
  className?: string
}) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const { contains } = ComboboxPrimitive.useFilter({ sensitivity: "base" })
  const [query, setQuery] = React.useState("")
  const [showAll, setShowAll] = React.useState(false)

  const matched = React.useMemo(
    () => items.filter((item) => contains(item, query)),
    [items, query, contains]
  )
  const visibleItems = showAll ? matched : matched.slice(0, visibleLimit)
  const hiddenCount = matched.length - visibleItems.length

  return (
    <ComboboxPrimitive.Root
      name={name}
      items={items}
      multiple
      defaultValue={defaultValue}
      filteredItems={visibleItems}
      onInputValueChange={(value) => {
        setQuery(value)
        setShowAll(false)
      }}
      onOpenChange={(open) => {
        if (!open) setShowAll(false)
      }}
    >
      <ComboboxPrimitive.InputGroup
        className={cn(
          "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          className
        )}
      >
        <ComboboxPrimitive.Value>
          {(value: string[]) => (
            <ComboboxPrimitive.Chips
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
              aria-label={value.length > 0 ? "Selected categories" : undefined}
            >
              {value.map((v) => (
                <ComboboxPrimitive.Chip
                  key={v}
                  className="flex h-6 items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-xs text-secondary-foreground outline-none focus-within:bg-accent focus-within:text-accent-foreground"
                  aria-label={v}
                  aria-description="Press Backspace or Delete to remove"
                >
                  {v}
                  <ComboboxPrimitive.ChipRemove
                    className="flex size-3.5 items-center justify-center rounded-full hover:bg-foreground/15"
                    aria-label={`Remove ${v}`}
                  >
                    <XIcon className="size-3" />
                  </ComboboxPrimitive.ChipRemove>
                </ComboboxPrimitive.Chip>
              ))}
              <ComboboxPrimitive.Input
                id={inputId}
                placeholder={value.length > 0 ? "" : placeholder}
                aria-description={
                  value.length > 0
                    ? `${value.length} selected. From the start of the input, press Left Arrow to focus the selected items`
                    : undefined
                }
                className="h-6 min-w-24 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
              />
            </ComboboxPrimitive.Chips>
          )}
        </ComboboxPrimitive.Value>
        <ComboboxPrimitive.Trigger
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          aria-label="Open categories"
        >
          <ChevronDownIcon className="size-4" />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner className="z-50 outline-none" sideOffset={4}>
          <ComboboxPrimitive.Popup className="w-(--anchor-width) max-h-[min(var(--available-height),20rem)] origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <ComboboxPrimitive.Empty className="px-2.5 py-2 text-sm text-muted-foreground">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: string) => (
                <ComboboxPrimitive.Item
                  key={item}
                  value={item}
                  className="relative flex cursor-default items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <ComboboxPrimitive.ItemIndicator className="flex size-3.5 shrink-0 items-center justify-center">
                    <CheckIcon className="size-3.5" />
                  </ComboboxPrimitive.ItemIndicator>
                  <span>{item}</span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="w-full px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => setShowAll(true)}
              >
                Show {hiddenCount} more…
              </button>
            )}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

export { MultiCombobox }
