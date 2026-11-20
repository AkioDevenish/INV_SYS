"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({
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
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
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
        This page could not be loaded right now. Try again, or return to your workspace home.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink/65">Reference: {error.digest}</p>
      )}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          <RotateCcw size={15} aria-hidden="true" /> Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Go home
        </Link>
      </div>
    </div>
  );
}
