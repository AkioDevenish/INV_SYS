"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AuthError({
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 py-12 text-center">
      <div className="panel flex w-full flex-col items-center p-7 sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-50 text-rose-700"
        >
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
          Unable to complete sign-in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/65">
          We could not reach the authentication service right now. Try again, or return to the
          sign-in screen.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-ink/60">Reference: {error.digest}</p>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            <RotateCcw size={15} aria-hidden="true" /> Try again
          </button>
          <Link href="/login" className="btn btn-ghost">
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
