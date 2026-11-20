"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import "./globals.css";

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
    <html lang="en">
      <body
        className="app-aurora min-h-screen bg-white text-ink antialiased"
        style={{
          fontFamily:
            '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <title>Something went wrong</title>
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-50 text-rose-700"
          >
            <AlertTriangle size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">
            An unexpected error interrupted the application. Try reloading the screen.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-ink/65">Reference: {error.digest}</p>
          )}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <button type="button" onClick={() => retry()} className="btn btn-primary">
              <RotateCcw size={15} aria-hidden="true" /> Try again
            </button>
            {/* Full document navigation is intentional when the root layout has errored. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="btn btn-ghost">
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
