export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading page…</span>
      <div className="space-y-2.5">
        <div className="h-3 w-24 animate-pulse rounded-full bg-ink/10 motion-reduce:animate-none" />
        <div className="h-7 w-56 animate-pulse rounded-lg bg-ink/10 motion-reduce:animate-none" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-ink/[0.07] motion-reduce:animate-none" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="panel space-y-2.5 p-4">
            <div className="h-2.5 w-20 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
            <div className="h-7 w-16 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-ink/[0.06] motion-reduce:animate-none" />
          </div>
        ))}
      </div>

      <div className="panel space-y-3 p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
        <div className="space-y-2.5 pt-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="h-10 w-full animate-pulse rounded-xl bg-ink/[0.05] motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
