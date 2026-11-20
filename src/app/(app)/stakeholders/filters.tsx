"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

type Option = { id: number; name: string; item_count?: number };

export function StakeholderFilters({
  groups,
}: {
  groups: Option[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQuery = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingDebounce = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    setSearch(urlQuery);
  }, [urlQuery]);

  const apply = (key: string, value: string) => {
    cancelPendingDebounce();
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower result set may not have the page you were on.
    next.delete("page");
    const qs = next.toString();
    startTransition(() =>
      router.replace(qs ? `/stakeholders?${qs}` : "/stakeholders", { scroll: false }),
    );
  };

  // Debounce free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    if (search === urlQuery) return;
    cancelPendingDebounce();
    timerRef.current = setTimeout(() => apply("q", search), 300);
    return cancelPendingDebounce;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = ["q", "group", "has", "sort"].some((k) => params.get(k));

  return (
    <div className="mb-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
      <div className="relative sm:col-span-2 xl:col-span-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, organisation, email or phone…"
          className="field pl-9"
          aria-label="Search stakeholders"
        />
        {pending && (
          <Loader2
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink/35"
          />
        )}
      </div>

      <select
        value={params.get("group") ?? ""}
        onChange={(e) => apply("group", e.target.value)}
        className="field"
        aria-label="Filter by group"
      >
        <option value="">All Groups</option>
        <option value="ungrouped">Ungrouped</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.item_count === undefined ? "" : ` (${g.item_count})`}
          </option>
        ))}
      </select>

      <select
        value={params.get("has") ?? ""}
        onChange={(e) => apply("has", e.target.value)}
        className="field"
        aria-label="Filter by contact details"
      >
        <option value="">Any Contact Details</option>
        <option value="email">Email</option>
        <option value="phone">Phone</option>
        <option value="nocontact">Missing Both</option>
      </select>

      <select
        value={params.get("sort") ?? "name"}
        onChange={(e) => apply("sort", e.target.value === "name" ? "" : e.target.value)}
        className="field"
        aria-label="Sort"
      >
        <option value="name">Sort: Name</option>
        <option value="organisation">Sort: Organisation</option>
        <option value="group">Sort: Group</option>
        <option value="updated">Sort: Recently Updated</option>
      </select>

      {hasFilters && (
        <button
          type="button"
          className="btn btn-ghost sm:col-span-2 xl:col-span-1"
          onClick={() => {
            cancelPendingDebounce();
            setSearch("");
            startTransition(() => router.replace("/stakeholders", { scroll: false }));
          }}
        >
          <X size={14} /> Clear
        </button>
      )}
    </div>
  );
}
