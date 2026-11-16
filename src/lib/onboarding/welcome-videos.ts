/**
 * Intro videos on the franchisee Welcome page. Paste a video's 11-character
 * YouTube id (the part after `shorts/` or `v=` in its URL) into `youtubeId`.
 * While it is `null` the page shows a "coming soon" card. `vertical` is for
 * YouTube Shorts (9:16); leave it off for normal 16:9 videos.
 */
export type WelcomeVideo = {
  title: string;
  description: string;
  youtubeId: string | null;
  vertical?: boolean;
};

export const WELCOME_VIDEOS: readonly WelcomeVideo[] = [
  {
    title: "TULSI - A vegetarian fine dining restaurant experience!!",
    description: "",
    youtubeId: "5x8nSQTrH2Y",
    vertical: true,
  },
  {
    title: "TULSI - Much more than a restaurant!",
    description: "",
    youtubeId: "G5MTHFNLsw4",
    vertical: true,
  },
];

/** YouTube video ids are exactly 11 chars of [A-Za-z0-9_-]. Guards against a typo becoming a broken or unsafe URL. */
export function isValidYoutubeId(id: string | null): id is string {
  return id !== null && /^[A-Za-z0-9_-]{11}$/.test(id);
}
