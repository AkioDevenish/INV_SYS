export default function AuthLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10"
    >
      <span className="sr-only">Loading authentication screen…</span>
      <div className="panel space-y-5 p-7 sm:p-8">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-ink/10 motion-reduce:animate-none" />
        <div className="space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
          <div className="h-3.5 w-64 max-w-full animate-pulse rounded bg-ink/[0.07] motion-reduce:animate-none" />
        </div>
        <div className="space-y-3 pt-2">
          <div className="h-10 w-full animate-pulse rounded-xl bg-ink/[0.06] motion-reduce:animate-none" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-ink/[0.06] motion-reduce:animate-none" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-iica-600/20 motion-reduce:animate-none" />
        </div>
      </div>
    </main>
  );
}
