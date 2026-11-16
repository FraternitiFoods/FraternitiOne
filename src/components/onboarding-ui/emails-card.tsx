import { Mail } from "lucide-react";
import { formatDateTime, humanize } from "@/lib/format";
import { ObCard, ObCardTitle } from "./card";

type RecentEmail = {
  id: string;
  templateKey: string;
  to: string;
  sentAt: Date;
  status: string;
};

/**
 * Franchisee-portal look of `RecentEmailsCard` (which stays as-is for the staff
 * app). Same data shape, same "No emails sent yet." empty state.
 */
export function ObEmailsCard({ emails, title }: { emails: RecentEmail[]; title: string }) {
  return (
    <ObCard className="px-6 py-7 sm:px-8">
      <ObCardTitle>{title}</ObCardTitle>
      {emails.length === 0 ? (
        <div className="mt-[18px] flex items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ob-sidebar)] text-[var(--ob-muted)]">
            <Mail className="size-5" strokeWidth={1.8} aria-hidden />
          </div>
          <p className="text-base text-[var(--ob-text-2)]">No emails sent yet.</p>
        </div>
      ) : (
        <ul className="mt-[18px] divide-y divide-[var(--ob-line)]">
          {emails.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ob-sidebar)] text-[var(--ob-muted)]">
                <Mail className="size-5" strokeWidth={1.8} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-[var(--ob-green)]">{humanize(e.templateKey)}</div>
                <div className="truncate text-sm text-[var(--ob-muted)]">
                  to {e.to} · {formatDateTime(e.sentAt)}
                </div>
              </div>
              <span className="rounded-full bg-[var(--ob-sidebar)] px-2.5 py-0.5 text-xs font-bold text-[var(--ob-nav)]">
                {e.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ObCard>
  );
}
