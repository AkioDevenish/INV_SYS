"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

type ItemOption = { id: number; name: string };

export function MovementFilters({ items }: { items: ItemOption[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQ = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQ);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    cancelPendingSearch();
    setSearch(urlQ);
  }, [urlQ, cancelPendingSearch]);

  const apply = useCallback(
    (key: string, value: string) => {
      cancelPendingSearch();
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      const query = next.toString();
      startTransition(() =>
        router.replace(query ? `/movements?${query}` : "/movements", { scroll: false }),
      );
    },
    [cancelPendingSearch, params, router],
  );

  useEffect(() => {
    if (search === urlQ) return;
    cancelPendingSearch();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      apply("q", search);
    }, 300);
    return cancelPendingSearch;
  }, [search, urlQ, apply, cancelPendingSearch]);

  const hasFilters = ["q", "type", "item"].some((k) => params.get(k)) || search !== "";

  const clearFilters = () => {
    cancelPendingSearch();
    setSearch("");
    startTransition(() => router.replace("/movements", { scroll: false }));
  };

  return (
    <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_180px_220px_auto]">
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/55"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by item, SKU, note, or user…"
          className="field pl-9"
          aria-label="Search movements"
        />
        {pending && (
          <Loader2
            size={15}
            aria-hidden="true"
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink/55"
          />
        )}
      </div>

      <select
        value={params.get("type") ?? ""}
        onChange={(e) => apply("type", e.target.value)}
        className="field"
        aria-label="Filter by movement type"
      >
        <option value="">All Movement Types</option>
        <option value="IN">Received (IN)</option>
        <option value="OUT">Issued (OUT)</option>
        <option value="ADJUST">Adjusted (ADJUST)</option>
      </select>

      <select
        value={params.get("item") ?? ""}
        onChange={(e) => apply("item", e.target.value)}
        className="field"
        aria-label="Filter by item"
      >
        <option value="">All Items</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button type="button" className="btn btn-ghost" onClick={clearFilters}>
          <X size={14} /> Clear
        </button>
      )}
    </div>
  );
}
