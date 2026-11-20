"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Columns3,
  EyeOff,
  FolderKanban,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Search,
  Table2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import type { LessonRow, ProjectSummary, RefOption } from "@/lib/projects";
import { formatDay, formatMoney, statusTone } from "@/lib/project-meta";
import { Chip } from "./project-ui";
import { FilterSelect } from "@/components/filter-select";

type ViewMode = "cards" | "table" | "phases" | "lessons";
const VIEW_MODES: readonly ViewMode[] = ["cards", "table", "phases", "lessons"];
type SortMode = "default" | "updated" | "title" | "target" | "overdue" | "phase";
const SORT_MODES: readonly SortMode[] = ["default", "updated", "title", "target", "overdue", "phase"];
const PAGE_SIZE = 18;

const pillClass = (active: boolean) =>
  `inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
    active
      ? "border-iica-700 bg-iica-700 text-white shadow-xs"
      : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
  }`;

const modeClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
    active
      ? "border-iica-700 bg-iica-700 text-white shadow-xs"
      : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
  }`;

function PhaseMeter({ order }: { order: number | null }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={order ? `Model phase ${order} of 8` : "No model phase"}>
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full ${order && i < order ? "bg-iica-600" : "bg-ink/10"}`}
        />
      ))}
    </div>
  );
}

function FundingLine({ p }: { p: ProjectSummary }) {
  if (p.funding.length === 0) return <span className="text-ink/60">No funding recorded</span>;
  return (
    <span className="tabular-nums">
      {p.funding.map((f, i) => (
        <span key={f.currency}>
          {i > 0 && " · "}
          {formatMoney(f.has_approved ? f.approved : f.requested, f.currency)}
          {f.received > 0 && <span className="text-ink/60"> ({formatMoney(f.received, f.currency)} in)</span>}
        </span>
      ))}
    </span>
  );
}

function parseParamId(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

export function ProjectsView({
  projects,
  lessons,
  statuses,
  phases,
  areas,
  tags,
  fundingStatuses,
  myProjectIds,
  todayKey,
}: {
  projects: ProjectSummary[];
  lessons: LessonRow[];
  statuses: RefOption[];
  phases: RefOption[];
  areas: RefOption[];
  tags: RefOption[];
  fundingStatuses: RefOption[];
  myProjectIds: number[];
  todayKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawView = (searchParams.get("view") ?? "cards").toLowerCase();
  const viewMode: ViewMode = (VIEW_MODES as readonly string[]).includes(rawView) ? (rawView as ViewMode) : "cards";
  const rawSort = (searchParams.get("sort") ?? "default").toLowerCase();
  const sortMode: SortMode = (SORT_MODES as readonly string[]).includes(rawSort) ? (rawSort as SortMode) : "default";
  const statusFilter = parseParamId(searchParams.get("status"));
  const phaseFilter = parseParamId(searchParams.get("phase"));
  const areaFilter = parseParamId(searchParams.get("area"));
  const tagFilter = parseParamId(searchParams.get("tag"));
  const fundingFilter = parseParamId(searchParams.get("funding"));
  const staffFilter = parseParamId(searchParams.get("staff"));
  const mine = searchParams.get("mine") === "1";
  const hideClosed = searchParams.get("active") === "1";
  const parsedPage = Number(searchParams.get("page"));
  const rawPage = Number.isFinite(parsedPage) ? Math.max(1, Math.trunc(parsedPage)) : 1;

  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const urlQ = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(urlQ);
  const prevUrlQRef = useRef(urlQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelPendingSearch(), [cancelPendingSearch]);

  useEffect(() => {
    if (urlQ !== prevUrlQRef.current) {
      prevUrlQRef.current = urlQ;
      if (!debounceRef.current) {
        setSearchInput(urlQ);
      }
    }
  }, [urlQ]);

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParamsRef.current.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const query = next.toString();
      router.replace(query ? `/projects?${query}` : "/projects", { scroll: false });
    },
    [router],
  );

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    cancelPendingSearch();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const trimmed = value.trim() || null;
      if ((trimmed ?? "") !== (searchParamsRef.current.get("q") ?? "")) {
        updateUrl({ q: trimmed, page: null });
      }
    }, 200);
  };

  const mineSet = useMemo(() => new Set(myProjectIds), [myProjectIds]);
  const queryTerm = searchInput.trim().toLowerCase();

  const staffOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of projects) for (const s of p.staff) map.set(s.user_id, s.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects]);

  const matchesStructural = useCallback(
    (p: ProjectSummary) => {
      if (hideClosed && p.is_closed) return false;
      if (mine && !mineSet.has(p.id)) return false;
      if (phaseFilter && p.model_phase_id !== phaseFilter) return false;
      if (areaFilter && !p.areas.some((a) => a.id === areaFilter)) return false;
      if (tagFilter && !p.tags.some((t) => t.id === tagFilter)) return false;
      if (fundingFilter && p.funding_status_id !== fundingFilter) return false;
      if (staffFilter && !p.staff.some((s) => s.user_id === staffFilter)) return false;
      return true;
    },
    [hideClosed, mine, mineSet, phaseFilter, areaFilter, tagFilter, fundingFilter, staffFilter],
  );

  const matchesBase = useCallback(
    (p: ProjectSummary) => {
      if (!matchesStructural(p)) return false;
      if (queryTerm) {
        const hay = `${p.code ?? ""} ${p.title} ${p.purpose ?? ""} ${p.outcome_summary ?? ""} ${p.areas
          .map((a) => a.name)
          .join(" ")} ${p.tags.map((t) => t.name).join(" ")} ${p.staff.map((s) => s.name).join(" ")}`.toLowerCase();
        if (!hay.includes(queryTerm)) return false;
      }
      return true;
    },
    [matchesStructural, queryTerm],
  );

  const preStatus = useMemo(() => projects.filter(matchesBase), [projects, matchesBase]);
  const statusCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const p of preStatus) c[p.status_id] = (c[p.status_id] ?? 0) + 1;
    return c;
  }, [preStatus]);
  const filtered = useMemo(() => {
    const list = statusFilter ? preStatus.filter((p) => p.status_id === statusFilter) : preStatus;
    if (sortMode === "default") return list;
    return [...list].sort((a, b) => {
      switch (sortMode) {
        case "updated":
          return b.updated_on.localeCompare(a.updated_on) || a.title.localeCompare(b.title);
        case "title":
          return a.title.localeCompare(b.title);
        case "target": {
          const at = a.target_end_date ?? "9999-12-31";
          const bt = b.target_end_date ?? "9999-12-31";
          return at.localeCompare(bt) || a.title.localeCompare(b.title);
        }
        case "overdue":
          return (
            b.overdue_actions - a.overdue_actions ||
            b.open_actions - a.open_actions ||
            a.title.localeCompare(b.title)
          );
        case "phase":
          return (b.phase_order ?? -1) - (a.phase_order ?? -1) || a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [preStatus, statusFilter, sortMode]);

  // Filter lessons by structural project filters only (NOT project queryTerm),
  // so searching lesson body text works even when the parent project title doesn't match.
  const filteredLessons = useMemo(() => {
    const ids = new Set(
      projects
        .filter((p) => matchesStructural(p) && (!statusFilter || p.status_id === statusFilter))
        .map((p) => p.id),
    );
    return lessons.filter((l) => {
      if (!ids.has(l.project_id)) return false;
      if (!queryTerm) return true;
      return `${l.body} ${l.project_title} ${l.project_code ?? ""} ${l.recorded_by_name ?? ""} ${l.areas
        .map((a) => a.name)
        .join(" ")}`
        .toLowerCase()
        .includes(queryTerm);
    });
  }, [projects, matchesStructural, statusFilter, lessons, queryTerm]);

  const listForView = viewMode === "lessons" ? filteredLessons : filtered;
  const totalPages = Math.max(1, Math.ceil(listForView.length / PAGE_SIZE));
  const safePage = Math.min(rawPage, totalPages);
  const pageProjects = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageLessons = filteredLessons.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const hasFilters = Boolean(
    statusFilter ||
      phaseFilter ||
      areaFilter ||
      tagFilter ||
      fundingFilter ||
      staffFilter ||
      mine ||
      hideClosed ||
      sortMode !== "default" ||
      searchInput.trim(),
  );
  const clearAll = () => {
    cancelPendingSearch();
    setSearchInput("");
    updateUrl({
      status: null,
      phase: null,
      area: null,
      tag: null,
      funding: null,
      staff: null,
      mine: null,
      active: null,
      sort: null,
      q: null,
      page: null,
    });
  };

  const statusName = (id: number | null) => statuses.find((s) => s.id === id)?.name;
  const heading =
    viewMode === "lessons"
      ? "Lessons learned"
      : viewMode === "phases"
        ? "Projects by IICA model phase"
        : statusFilter
          ? (statusName(statusFilter) ?? "Projects")
          : "All projects";

  const transitionKey = `${viewMode}-${sortMode}-${statusFilter}-${phaseFilter}-${areaFilter}-${tagFilter}-${fundingFilter}-${staffFilter}-${mine}-${hideClosed}-${safePage}`;

  const statusChip = (p: ProjectSummary) => (
    <Chip className={statusTone(p.status_position, p.is_closed, p.status_name)}>{p.status_name}</Chip>
  );

  const endHint = (p: ProjectSummary) => {
    if (p.actual_end_date) return `Ended ${formatDay(p.actual_end_date)}`;
    if (p.target_end_date) {
      const late = !p.is_closed && p.target_end_date < todayKey;
      return late ? `Past target ${formatDay(p.target_end_date)}` : `Target ${formatDay(p.target_end_date)}`;
    }
    if (p.start_date) return `Started ${formatDay(p.start_date)}`;
    return "No dates set";
  };

  const empty = (
    <EmptyState
      icon={<FolderKanban size={20} />}
      title={projects.length === 0 ? "No projects yet" : "No projects match those filters"}
      description={
        projects.length === 0
          ? "Create the first project record with New project."
          : "Try clearing the search or a filter."
      }
      action={
        hasFilters ? (
          <button type="button" onClick={clearAll} className="btn btn-ghost text-xs">
            Clear filters
          </button>
        ) : undefined
      }
    />
  );

  const selectClass = "w-full sm:w-auto sm:min-w-[10rem] sm:max-w-[14rem]";

  return (
    <div className="space-y-4">
      {/* 1. Status pills and filters */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={statusFilter ? String(statusFilter) : ""}
            onChange={(v) => updateUrl({ status: v || null, page: null })}
            className={selectClass}
            ariaLabel="Filter by status"
            options={[
              { value: "", label: "All statuses", count: preStatus.length },
              ...statuses.map((s) => ({ value: String(s.id), label: s.name, count: statusCounts[s.id] ?? 0 })),
            ]}
          />
          <button type="button" aria-pressed={mine} onClick={() => updateUrl({ mine: mine ? null : "1", page: null })} className={pillClass(mine)}>
            <UserCheck size={13} aria-hidden="true" />
            <span>My projects</span>
          </button>
          <button
            type="button"
            aria-pressed={hideClosed}
            onClick={() => updateUrl({ active: hideClosed ? null : "1", page: null })}
            className={pillClass(hideClosed)}
          >
            <EyeOff size={13} aria-hidden="true" />
            <span>Hide closed</span>
          </button>
          <div className="relative min-w-[200px] flex-1 sm:w-64 sm:flex-none">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/60" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={viewMode === "lessons" ? "Search lessons…" : "Search code, title, purpose, tags…"}
              aria-label="Search projects"
              className="field py-1.5 pr-7 pl-8 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  cancelPendingSearch();
                  setSearchInput("");
                  updateUrl({ q: null, page: null });
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/60 hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <FilterSelect
            value={phaseFilter ? String(phaseFilter) : ""}
            onChange={(v) => updateUrl({ phase: v || null, page: null })}
            className={selectClass}
            ariaLabel="Filter by model phase"
            options={[{ value: "", label: "Any model phase" }, ...phases.map((p) => ({ value: String(p.id), label: `${p.position}. ${p.name}` }))]}
          />
          <FilterSelect
            value={areaFilter ? String(areaFilter) : ""}
            onChange={(v) => updateUrl({ area: v || null, page: null })}
            className={selectClass}
            ariaLabel="Filter by programme area"
            options={[{ value: "", label: "Any programme area" }, ...areas.map((a) => ({ value: String(a.id), label: a.name }))]}
          />
          {tags.length > 0 && (
            <FilterSelect
              value={tagFilter ? String(tagFilter) : ""}
              onChange={(v) => updateUrl({ tag: v || null, page: null })}
              className={selectClass}
              ariaLabel="Filter by tag"
              options={[
                { value: "", label: "Any tag" },
                ...tags.map((t) => ({
                  value: String(t.id),
                  label: t.category ? `${t.category}: ${t.name}` : t.name,
                })),
              ]}
            />
          )}
          <FilterSelect
            value={fundingFilter ? String(fundingFilter) : ""}
            onChange={(v) => updateUrl({ funding: v || null, page: null })}
            className={selectClass}
            ariaLabel="Filter by funding status"
            options={[{ value: "", label: "Any funding status" }, ...fundingStatuses.map((f) => ({ value: String(f.id), label: f.name }))]}
          />
          <FilterSelect
            value={staffFilter ? String(staffFilter) : ""}
            onChange={(v) => updateUrl({ staff: v || null, page: null })}
            className={selectClass}
            ariaLabel="Filter by staff member"
            options={[{ value: "", label: "Any staff member" }, ...staffOptions.map(([id, name]) => ({ value: String(id), label: name }))]}
          />
          {viewMode !== "lessons" && (
            <FilterSelect
              value={sortMode}
              onChange={(v) => updateUrl({ sort: v === "default" ? null : v, page: null })}
              className={selectClass}
              ariaLabel="Sort projects"
              options={[
                { value: "default", label: "Sort: Status & title" },
                { value: "updated", label: "Sort: Recently updated" },
                { value: "title", label: "Sort: Title (A–Z)" },
                { value: "target", label: "Sort: Target end date" },
                { value: "overdue", label: "Sort: Most overdue" },
                { value: "phase", label: "Sort: Highest phase" },
              ]}
            />
          )}
          {hasFilters && (
            <button type="button" onClick={clearAll} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* 2. Workspace panel */}
      <div className="panel relative">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">{heading}</h2>
          <div role="group" aria-label="Projects display mode" className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: "cards", label: "Cards", icon: <LayoutGrid size={13} aria-hidden="true" /> },
                { id: "table", label: "Table", icon: <Table2 size={13} aria-hidden="true" /> },
                { id: "phases", label: "Phases", icon: <Columns3 size={13} aria-hidden="true" /> },
                { id: "lessons", label: "Lessons", icon: <BookOpen size={13} aria-hidden="true" /> },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={viewMode === m.id}
                onClick={() => updateUrl({ view: m.id === "cards" ? null : m.id, page: null })}
                className={modeClass(viewMode === m.id)}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {viewMode === "cards" && (
          <div key={transitionKey} className="animate-fade p-4 sm:p-5">
            {filtered.length === 0 ? (
              empty
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {pageProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="flex flex-col justify-between rounded-2xl border border-ink/10 bg-white p-3.5 transition hover:border-iica-300 hover:bg-iica-50/20"
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {statusChip(p)}
                          {p.overdue_actions > 0 && (
                            <Chip className="border-rose-200 bg-rose-50 text-rose-800">
                              <AlertTriangle size={10} className="mr-1" aria-hidden="true" />
                              {p.overdue_actions} overdue
                            </Chip>
                          )}
                        </div>
                        {p.code && <span className="text-[11px] font-semibold text-ink/60 tabular-nums">{p.code}</span>}
                      </div>
                      <div className="mt-2 text-sm font-semibold leading-snug text-ink">{p.title}</div>
                      {p.purpose && <p className="mt-1 line-clamp-2 text-xs text-ink/60">{p.purpose}</p>}

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/60">
                          <span>Model phase</span>
                          <span>{p.phase_order ? `${p.phase_order}/8` : "-"}</span>
                        </div>
                        <PhaseMeter order={p.phase_order} />
                        {p.phase_name && <div className="mt-1 truncate text-[11px] text-ink/60">{p.phase_name}</div>}
                      </div>

                      <div className="mt-2.5 space-y-1 text-[11px] text-ink/60">
                        <div className="flex items-center gap-1.5 truncate">
                          <Users size={11} className="shrink-0 text-ink/60" aria-hidden="true" />
                          <span className="truncate">
                            {p.staff.length ? p.staff.map((s) => s.name).filter((n, i, a) => a.indexOf(n) === i).join(", ") : "No staff assigned"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <CalendarClock size={11} className="shrink-0 text-ink/60" aria-hidden="true" />
                          <span className="truncate">{endHint(p)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-2.5 text-[11px] text-ink/60">
                      <FundingLine p={p} />
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-0.5" title="Open actions">
                          <ListChecks size={11} aria-hidden="true" /> {p.open_actions}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="Updates">
                          <MessageSquareText size={11} aria-hidden="true" /> {p.update_count}
                        </span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === "table" && (
          <div key={transitionKey} className="animate-fade">
            {filtered.length === 0 ? (
              <div className="p-4">{empty}</div>
            ) : (
              <>
                <ul className="divide-y divide-ink/8 md:hidden">
                  {pageProjects.map((p) => (
                    <li key={p.id} className="px-4 py-3.5">
                      <Link href={`/projects/${p.id}`} className="block">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {statusChip(p)}
                            {p.overdue_actions > 0 && (
                              <Chip className="border-rose-200 bg-rose-50 text-rose-800">
                                {p.overdue_actions} overdue
                              </Chip>
                            )}
                          </div>
                          {p.code && <span className="text-[11px] font-semibold text-ink/60 tabular-nums">{p.code}</span>}
                        </div>
                        <div className="mt-1.5 text-sm font-semibold text-ink">{p.title}</div>
                        {p.areas.length > 0 && (
                          <div className="mt-0.5 text-xs text-ink/60">{p.areas.map((a) => a.name).join(", ")}</div>
                        )}
                        <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs text-ink/70">
                          <div>
                            <div className="text-[11px] text-ink/60">Phase</div>
                            <div className="truncate font-medium text-ink/85">{p.phase_name ?? "Not assigned"}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-ink/60">Dates</div>
                            <div className="truncate font-medium text-ink/85">{endHint(p)}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/65">
                          <div className="truncate">
                            {p.funding_status_name ? `${p.funding_status_name} · ` : ""}
                            <FundingLine p={p} />
                          </div>
                          <span className="shrink-0 tabular-nums">
                            <span className="font-semibold text-ink">{p.open_actions}</span> open
                          </span>
                        </div>
                        {p.last_update_date && (
                          <div className="mt-2 rounded-lg bg-iica-50/50 px-2.5 py-1.5 text-xs text-ink/70">
                            <span className="font-medium text-ink/85">{formatDay(p.last_update_date)}</span>
                            {p.last_update_body ? ` — ${p.last_update_body}` : ""}
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Phase</th>
                        <th>Funding</th>
                        <th>Dates</th>
                        <th>Latest update</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageProjects.map((p) => (
                        <tr key={p.id}>
                          <td className="min-w-[14rem]">
                            <Link href={`/projects/${p.id}`} className="font-semibold text-ink hover:text-iica-700 hover:underline">
                              {p.title}
                            </Link>
                            <div className="mt-0.5 text-xs text-ink/60">
                              {[p.code, p.areas.map((a) => a.name).join(", ")].filter(Boolean).join(" · ") || " "}
                            </div>
                          </td>
                          <td>{statusChip(p)}</td>
                          <td className="min-w-[9rem] text-xs text-ink/70">
                            <PhaseMeter order={p.phase_order} />
                            <div className="mt-1 truncate">{p.phase_name ?? "Not assigned"}</div>
                          </td>
                          <td className="text-xs text-ink/70">
                            <div className="font-medium text-ink/85">{p.funding_status_name ?? "-"}</div>
                            <div className="text-[11px]">
                              <FundingLine p={p} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap text-xs text-ink/70">{endHint(p)}</td>
                          <td className="max-w-xs text-xs text-ink/70">
                            {p.last_update_date ? (
                              <>
                                <div className="font-medium text-ink/80">{formatDay(p.last_update_date)}</div>
                                <div className="line-clamp-2">{p.last_update_body}</div>
                              </>
                            ) : (
                              <span className="text-ink/60">None yet</span>
                            )}
                          </td>
                          <td className="text-right text-xs whitespace-nowrap">
                            <span className="font-semibold text-ink tabular-nums">{p.open_actions}</span>
                            <span className="text-ink/60"> open</span>
                            {p.overdue_actions > 0 && (
                              <div className="text-[11px] font-medium text-rose-700">{p.overdue_actions} overdue</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {viewMode === "phases" && (
          <div key={transitionKey} className="animate-fade overflow-x-auto p-4 sm:p-5">
            {filtered.length === 0 ? (
              empty
            ) : (
              <div className="grid min-w-[1100px] grid-cols-9 gap-2.5">
                {[...phases.map((ph) => ({ id: ph.id as number | null, order: ph.position, name: ph.name })), { id: null, order: 0, name: "No phase yet" }].map((col) => {
                  const items = filtered.filter((p) => (p.model_phase_id ?? null) === col.id);
                  return (
                    <section key={col.id ?? "none"} className="flex min-w-0 flex-col rounded-2xl border border-ink/8 bg-iica-50/30">
                      <div className="border-b border-ink/8 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-iica-700 text-[10px] font-bold text-white">
                            {col.order || "–"}
                          </span>
                          <span className="rounded-full bg-ink/6 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink/65">{items.length}</span>
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-snug text-ink">{col.name}</div>
                      </div>
                      <div className="max-h-[65vh] space-y-1.5 overflow-y-auto p-2">
                        {items.map((p) => (
                          <Link
                            key={p.id}
                            href={`/projects/${p.id}`}
                            className="block rounded-xl border border-ink/10 bg-white p-2 transition hover:border-iica-300"
                          >
                            <div className="line-clamp-3 text-[11px] font-semibold leading-snug text-ink">{p.title}</div>
                            <div className="mt-1.5">{statusChip(p)}</div>
                          </Link>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === "lessons" && (
          <div key={transitionKey} className="animate-fade space-y-2 p-4 sm:p-5">
            {filteredLessons.length === 0 ? (
              <EmptyState
                icon={<BookOpen size={20} />}
                title={lessons.length === 0 ? "No lessons recorded yet" : "No lessons match those filters"}
                description={
                  lessons.length === 0
                    ? "Lessons are added on each project's page and collected here so they can be found when planning similar work."
                    : "Try clearing the search or a filter."
                }
                action={
                  hasFilters ? (
                    <button type="button" onClick={clearAll} className="btn btn-ghost text-xs">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              pageLessons.map((l) => (
                <article key={l.id} className="rounded-xl border border-ink/10 bg-white p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/60">
                    <Link href={`/projects/${l.project_id}?tab=lessons`} className="font-semibold text-iica-700 hover:underline">
                      {l.project_code ? `${l.project_code} · ` : ""}
                      {l.project_title}
                    </Link>
                    <span>
                      {formatDay(l.recorded_on)}
                      {l.recorded_by_name ? ` · ${l.recorded_by_name}` : ""}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink/80">{l.body}</p>
                  {l.areas.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {l.areas.map((a) => (
                        <Chip key={a.id} className="border-ink/12 bg-iica-50/70 text-ink/70">
                          {a.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {(viewMode === "cards" || viewMode === "table" || viewMode === "lessons") && (
          <Pagination
            page={safePage}
            perPage={PAGE_SIZE}
            total={listForView.length}
            basePath="/projects"
            params={{
              view: viewMode === "cards" ? undefined : viewMode,
              sort: sortMode === "default" ? undefined : sortMode,
              status: statusFilter ? String(statusFilter) : undefined,
              phase: phaseFilter ? String(phaseFilter) : undefined,
              area: areaFilter ? String(areaFilter) : undefined,
              tag: tagFilter ? String(tagFilter) : undefined,
              funding: fundingFilter ? String(fundingFilter) : undefined,
              staff: staffFilter ? String(staffFilter) : undefined,
              mine: mine ? "1" : undefined,
              active: hideClosed ? "1" : undefined,
              q: searchInput.trim() || undefined,
            }}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-3.5 py-3 text-xs text-ink/60 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {statuses.map((s) => (
              <span
                key={s.id}
                className={`inline-flex cursor-default items-center rounded-lg border px-2.5 py-0.5 text-[11px] font-medium select-none ${statusTone(s.position, Boolean(s.is_closed), s.name)}`}
              >
                {s.name}
              </span>
            ))}
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
            <span>{viewMode === "lessons" ? "Total lessons:" : "Total projects:"}</span>
            <span className="font-semibold text-ink tabular-nums">{listForView.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
