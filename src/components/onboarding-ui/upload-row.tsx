import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * One document row: icon circle, title (+ optional "Required" tag), a status /
 * file line, and a right-hand action slot. Wraps under the text on narrow
 * screens. `children` renders full-width under the row (inline errors).
 */
export function UploadRow({
  icon: Icon,
  title,
  required = false,
  status,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  required?: boolean;
  status: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-[var(--ob-line)] bg-[var(--ob-bg)] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[var(--ob-line)] bg-white text-[var(--ob-green)]">
          <Icon className="size-[22px]" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="min-w-[9rem] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[17px] font-bold text-[var(--ob-green)]">{title}</span>
            {required && (
              <span className="rounded-full bg-[#fbe6c8] px-2.5 py-[3px] text-xs font-bold text-[#7a4200]">Required</span>
            )}
          </div>
          <div className="mt-0.5 text-sm text-[var(--ob-muted)]">{status}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
