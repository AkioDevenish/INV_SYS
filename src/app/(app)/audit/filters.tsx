"use client";

import { useSyncedState } from "@/lib/use-synced-state";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";

type Category = { key: string; label: string; count: number };
type ModuleOption = { key: string; label: string };

export function AuditFilters({
  categories,
  modules,
  total,
}: {
  categories: Category[];
  modules: ModuleOption[];
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlQ = params.get("q") ?? "";
  // Follows the URL on Back/Forward while staying editable in between.
  const [search, setSearch] = useSyncedState(urlQ);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDebounce = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // A URL change makes any half-typed search stale.
  useEffect(() => {
    cancelDebounce();
  }, [urlQ]);

  useEffect(() => cancelDebounce, []);

  const apply = (key: string, value: string) => {
    cancelDebounce();
    const next = new URLSearchParams(paramsRef.current.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `/audit?${qs}` : "/audit", { scroll: false }));
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    cancelDebounce();
    timerRef.current = setTimeout(() => {
      const next = new URLSearchParams(paramsRef.current.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `/audit?${qs}` : "/audit", { scroll: false }));
    }, 300);
  };

  const rawCategory = params.get("category") ?? "";
  const activeCategory = categories.some((c) => c.key === rawCategory) ? rawCategory : "";
  const activeModule = modules.some((m) => m.key === (params.get("module") ?? ""))
    ? (params.get("module") ?? "")
    : "";
  const hasFilters = ["q", "category", "module", "page"].some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
      <FilterSelect
        value={activeCategory}
        onChange={(v) => apply("category", v)}
        className="w-full sm:w-auto sm:min-w-[12rem]"
        ariaLabel="Filter by activity"
        options={[
          { value: "", label: "Everything", count: total },
          ...categories.map((c) => ({ value: c.key, label: c.label, count: c.count, disabled: c.count === 0 && activeCategory !== c.key })),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={activeModule}
          onChange={(v) => apply("module", v)}
          className="min-w-[10rem]"
          ariaLabel="Filter by module"
          options={[{ value: "", label: "All modules" }, ...modules.map((m) => ({ value: m.key, label: m.label }))]}
        />

        <div className="relative min-w-[200px] flex-1 sm:w-60 sm:flex-none">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/45"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search person, action or detail..."
            className="field py-1.5 pr-8 pl-8 text-xs"
            aria-label="Search the audit trail"
          />
          {pending ? (
            <Loader2
              size={14}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 animate-spin text-ink/45"
            />
          ) : (
            search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  apply("q", "");
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/50 hover:text-ink"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )
          )}
        </div>

        {hasFilters && (
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
            onClick={() => {
              cancelDebounce();
              setSearch("");
              startTransition(() => router.replace("/audit", { scroll: false }));
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
