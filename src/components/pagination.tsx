import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/format";

/**
 * Page links are real links carrying the current filters, so a page is
 * bookmarkable and the back button behaves. Rendered server-side; there is no
 * client state to keep in sync.
 */
export function Pagination({
  page,
  perPage,
  total,
  basePath,
  params,
}: {
  page: number;
  perPage: number;
  total: number;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const safePerPage = Number.isFinite(perPage) && perPage > 0 ? Math.trunc(perPage) : 1;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePerPage));
  if (pageCount <= 1) return null;

  const safePage = Number.isFinite(page)
    ? Math.min(pageCount, Math.max(1, Math.trunc(page)))
    : 1;

  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item) next.append(k, item);
        }
      } else if (v) {
        next.set(k, v);
      }
    }
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const first = (safePage - 1) * safePerPage + 1;
  const last = Math.min(safeTotal, safePage * safePerPage);

  // A compact window around the current page: 1 … 4 5 6 … 21
  const window = new Set<number>([1, pageCount, safePage, safePage - 1, safePage + 1]);
  if (safePage <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (safePage >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => window.add(n));
  }
  const pages = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-ink/8 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <p className="text-xs text-ink/65">
        Showing {formatNumber(first)}-{formatNumber(last)} of {formatNumber(safeTotal)}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        {safePage > 1 ? (
          <Link href={href(safePage - 1)} className="btn btn-ghost px-2.5 py-1.5" aria-label="Previous page">
            <ChevronLeft size={15} aria-hidden="true" />
          </Link>
        ) : (
          <span className="btn btn-ghost pointer-events-none px-2.5 py-1.5 opacity-40" aria-hidden="true">
            <ChevronLeft size={15} aria-hidden="true" />
          </span>
        )}

        {pages.map((n, index) => (
          <span key={n} className="flex items-center gap-1">
            {index > 0 && pages[index - 1] !== n - 1 && (
              <span aria-hidden="true" className="px-1 text-xs text-ink/65">…</span>
            )}
            {n === safePage ? (
              <span
                aria-current="page"
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-iica-700 px-2 text-sm font-semibold text-white"
              >
                {formatNumber(n)}
              </span>
            ) : (
              <Link
                href={href(n)}
                aria-label={`Page ${n}`}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm text-ink/75 transition hover:bg-iica-50 hover:text-iica-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
              >
                {formatNumber(n)}
              </Link>
            )}
          </span>
        ))}

        {safePage < pageCount ? (
          <Link href={href(safePage + 1)} className="btn btn-ghost px-2.5 py-1.5" aria-label="Next page">
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <span className="btn btn-ghost pointer-events-none px-2.5 py-1.5 opacity-40" aria-hidden="true">
            <ChevronRight size={15} aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}
