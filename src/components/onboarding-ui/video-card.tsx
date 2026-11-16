import type { ReactNode } from "react";

/**
 * White frame + caption around a video tile. The tile itself (thumbnail, play
 * button, click-to-load iframe) is `YoutubeFacade`, passed as children.
 */
export function VideoCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <article className="flex w-full max-w-[300px] min-w-0 flex-col rounded-[28px] bg-white p-2.5 shadow-[0_22px_40px_-26px_rgb(15_51_36/0.45),0_0_0_1px_rgb(15_51_36/0.06)] sm:w-[300px]">
      {children}
      <div className="px-3 pt-4 pb-2.5">
        <div className="ob-display text-lg leading-[1.3] font-medium text-[var(--ob-green)]">{title}</div>
        {description && <p className="mt-1 text-sm text-[var(--ob-muted)]">{description}</p>}
      </div>
    </article>
  );
}
