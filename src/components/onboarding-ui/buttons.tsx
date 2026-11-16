import type { ComponentProps } from "react";
import Link from "next/link";
import { cn } from "cn";

export type ObButtonVariant = "solid" | "outline" | "saffron";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 font-bold whitespace-nowrap transition-[filter,background-color] disabled:pointer-events-none disabled:opacity-60";

const VARIANTS: Record<ObButtonVariant, string> = {
  solid: "ob-focus border-0 bg-[var(--ob-green)] text-[var(--ob-cream)] hover:brightness-125",
  outline:
    "ob-focus border-[1.5px] border-[var(--ob-green)] bg-transparent text-[var(--ob-green)] hover:bg-[var(--ob-green)]/8",
  // Only for use on the dark-green cards.
  saffron: "ob-focus-dark border-0 bg-[var(--ob-saffron)] text-[var(--ob-green)] hover:brightness-110",
};

const SIZES = {
  md: "h-[46px] rounded-xl px-5 text-[15px]",
  lg: "h-14 rounded-[14px] px-7 text-[15px]",
} as const;

export function obButtonClass(variant: ObButtonVariant = "solid", size: keyof typeof SIZES = "md", className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export function ObButton({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ObButtonVariant; size?: keyof typeof SIZES }) {
  return <button type={type} className={obButtonClass(variant, size, className)} {...props} />;
}

export function ObLinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ObButtonVariant; size?: keyof typeof SIZES }) {
  return <Link className={obButtonClass(variant, size, className)} {...props} />;
}
