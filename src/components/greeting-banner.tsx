"use client";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Time-of-day greeting from the viewer's own device clock — never the
 * server's (Vercel runs UTC, the business runs IST, so a server-computed
 * greeting would be wrong most of the day). `suppressHydrationWarning` is
 * needed because the server's first-paint HTML is necessarily computed on
 * its own clock before this client component takes over; React then patches
 * just this text node to the browser's real local time during hydration.
 */
export function GreetingBanner({ name }: { name: string }) {
  return (
    <p className="text-xl font-semibold" suppressHydrationWarning>
      {greetingForHour(new Date().getHours())}, {name}!
    </p>
  );
}
