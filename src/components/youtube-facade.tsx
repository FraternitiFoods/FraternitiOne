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
  const aspect = vertical ? "aspect-[9/16]" : "aspect-video";

  if (!isValidYoutubeId(youtubeId)) {
    return (
      <div
        className={`flex ${aspect} w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/50 text-muted-foreground`}
      >
        <Play className="size-8 opacity-40" aria-hidden />
        <span className="text-xs">Video coming soon</span>
      </div>
    );
  }

  if (playing) {
    return (
      <iframe
        className={`${aspect} w-full rounded-xl`}
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
      className={`group relative block ${aspect} w-full overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-3 focus-visible:ring-ring/50`}
    >
      {/* Plain <img>: a ~15KB third-party thumbnail; lazy so it never competes with first paint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-105">
          <Play className="size-6 translate-x-0.5 fill-current" aria-hidden />
        </span>
      </span>
    </button>
  );
}
