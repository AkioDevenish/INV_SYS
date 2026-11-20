"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import {
  CONDITIONS,
  CONDITION_META,
  FLAGGED_CONDITIONS,
  RETIRED_CONDITIONS,
} from "@/lib/conditions";

type Option = { id: number; name: string };

export function InventoryFilters({
  categories,
  locations,
  conditionCounts = {},
  hideCategory = false,
  locationPlaceholder = "All Locations",
}: {
  categories: Option[];
  locations: Option[];
  /** Counts per condition, scoped to the active inventory tab. */
  conditionCounts?: Record<string, number>;
  /**
   * True on a tab that already pins the category. The dropdown is dropped
   * rather than shown pre-set, because a control you cannot meaningfully
   * change is worse than no control at all.
   */
  hideCategory?: boolean;
  locationPlaceholder?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQ = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQ);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flaggedTotal = FLAGGED_CONDITIONS.reduce((n, c) => n + (conditionCounts[c] ?? 0), 0);
  const retiredTotal = RETIRED_CONDITIONS.reduce((n, c) => n + (conditionCounts[c] ?? 0), 0);

  const cancelPendingSearch = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Keep input synchronized with URL on Back/Forward or tab navigation.
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
        router.replace(query ? `/inventory?${query}` : "/inventory", { scroll: false }),
      );
    },
    [cancelPendingSearch, params, router],
  );

  // Debounce free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    if (search === urlQ) return;
    cancelPendingSearch();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      apply("q", search);
    }, 300);
    return cancelPendingSearch;
  }, [search, urlQ, apply, cancelPendingSearch]);

  /*
   * The tab you are on is not a filter you applied, it is where you are. It
   * arrives in the URL as locationGroup (or as the pinned category on a tab
   * that owns one), so neither turns Clear on, and neither is thrown away by
   * it: clearing returns you to an unfiltered version of the same tab rather
   * than dumping you back on IICA Items.
   */
  const pinnedCategory = hideCategory ? params.get("category") : null;
  const locationGroup = params.get("locationGroup");
  const hasFilters =
    ["q", "location", "stock", "condition", "sort"].some((k) => params.get(k)) ||
    (!hideCategory && !!params.get("category")) ||
    search !== "";

  const clearFilters = () => {
    cancelPendingSearch();
    setSearch("");
    const kept = new URLSearchParams();
    if (locationGroup) kept.set("locationGroup", locationGroup);
    if (pinnedCategory) kept.set("category", pinnedCategory);
    const query = kept.toString();
    startTransition(() =>
      router.replace(query ? `/inventory?${query}` : "/inventory", { scroll: false }),
    );
  };

  return (
    <div
      className={`mb-4 grid gap-2.5 sm:grid-cols-2 ${
        hideCategory
          ? "xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]"
          : "xl:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]"
      }`}
    >
      <div className="relative sm:col-span-2 xl:col-span-1">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/55"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, SKU or supplier…"
          className="field pl-9"
          aria-label="Search inventory"
        />
        {pending && (
          <Loader2
            size={15}
            aria-hidden="true"
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink/55"
          />
        )}
      </div>

      {!hideCategory && (
        <select
          value={params.get("category") ?? ""}
          onChange={(e) => apply("category", e.target.value)}
          className="field"
          aria-label="Filter by category"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={params.get("location") ?? ""}
        onChange={(e) => apply("location", e.target.value)}
        className="field"
        aria-label="Filter by location"
      >
        <option value="">{locationPlaceholder}</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <select
        value={params.get("stock") ?? ""}
        onChange={(e) => apply("stock", e.target.value)}
        className="field"
        aria-label="Filter by stock level"
      >
        <option value="">Any Stock Level</option>
        <option value="attention">Low or Out Of Stock</option>
        <option value="low">Low Stock</option>
        <option value="out">Out Of Stock</option>
      </select>

      <select
        value={params.get("condition") ?? ""}
        onChange={(e) => apply("condition", e.target.value)}
        className="field"
        aria-label="Filter by condition"
      >
        <option value="">Any Condition</option>
        <option value="flagged">Needs Attention ({flaggedTotal})</option>
        <option value="retired">Retired ({retiredTotal})</option>
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {CONDITION_META[c].label} ({conditionCounts[c] ?? 0})
          </option>
        ))}
      </select>

      <select
        value={params.get("sort") ?? "name"}
        onChange={(e) => apply("sort", e.target.value === "name" ? "" : e.target.value)}
        className="field"
        aria-label="Sort"
      >
        <option value="name">Sort: Name</option>
        <option value="quantity">Sort: Lowest Stock</option>
        <option value="value">Sort: Highest Value</option>
        <option value="updated">Sort: Recently Updated</option>
      </select>

      {hasFilters && (
        <button
          type="button"
          className="btn btn-ghost sm:col-span-2 xl:col-span-1"
          onClick={clearFilters}
        >
          <X size={14} /> Clear
        </button>
      )}
    </div>
  );
}
