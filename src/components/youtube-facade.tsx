"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { isValidYoutubeId } from "@/lib/onboarding/welcome-videos";

/**
 * Click-to-load YouTube embed. A real YouTube iframe pulls in hundreds of KB of
 * JS, so the page only shows a thumbnail + play button and creates the iframe
 * when the franchisee actually presses play. With no (or an invalid) id it
 * renders a "coming soon" card, so the Welcome page works before the videos
 * are uploaded.
 */
export function YoutubeFacade({
  title,
  youtubeId,
  vertical = false,
}: {
  title: string;
  youtubeId: string | null;
  /** 9:16 (YouTube Shorts) instead of 16:9. */
  vertical?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  // Portrait tiles are a bit wider than 9:16 so the card is not taller than the screen; the thumbnail is scaled up (below) to fill them.
  const aspect = vertical ? "aspect-[2/3]" : "aspect-video";

  if (!isValidYoutubeId(youtubeId)) {
    return (
      <div
        className={`flex ${aspect} w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[var(--ob-green)]/25 bg-[var(--ob-bg)] text-[var(--ob-muted)]`}
      >
        <Play className="size-8 opacity-40" aria-hidden />
        <span className="text-xs">Video coming soon</span>
      </div>
    );
  }

  if (playing) {
    return (
      <iframe
        className={`${aspect} w-full rounded-[20px]`}
        src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play video: ${title}`}
      className={`group relative block ${aspect} w-full overflow-hidden rounded-[20px] bg-black outline-none ob-focus`}
    >
      {/* Plain <img>: a ~15KB third-party thumbnail; lazy so it never competes with first paint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        decoding="async"
        // A Short's hqdefault is a 4:3 frame with the vertical video pillarboxed in the middle: scale it so the bars are cropped out.
        className={`size-full object-cover transition-transform duration-300 ${vertical ? "scale-[1.25] group-hover:scale-[1.3]" : "group-hover:scale-105"}`}
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-[66px] items-center justify-center rounded-full bg-[var(--ob-saffron)] text-[var(--ob-green)] shadow-[0_0_0_9px_rgb(255_255_255/0.35)] transition-transform group-hover:scale-105">
          <Play className="size-[26px] translate-x-[3px] fill-current" aria-hidden />
        </span>
      </span>
    </button>
  );
}
