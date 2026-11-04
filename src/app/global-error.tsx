"use client";

import { useEffect } from "react";
import { Montserrat, Geist_Mono } from "next/font/google";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={`${montserrat.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h2 className="text-sm font-semibold">Something went wrong</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          The app failed to load.
          {error.digest && <> Error reference: {error.digest}.</>}
        </p>
        <button
          onClick={() => retry()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
