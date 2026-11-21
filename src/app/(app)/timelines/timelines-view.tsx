"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Compass,
  Flag,
  GaugeCircle,
  ListChecks,
  MessageSquareText,
  Search,
  Table2,
  User,
  UserCheck,
  X,
  ArrowUpRight,
  MessagesSquare,
  Repeat,
} from "lucide-react";
import { CommentThread } from "@/components/comment-thread";
import { BulkBar } from "./bulk-bar";
import { EmptyState } from "@/components/ui";
import { FilterSelect } from "@/components/filter-select";
import { SavedViews } from "@/components/saved-views";
import { Pagination } from "@/components/pagination";
import { RowActions } from "@/components/icon-button";
import {
  PRIORITIES,
  PRIORITY_META,
  STATUS_META,
  TASK_STATUSES,
  PROJECT_AREA,
  areaLabel,
  isPriority,
  type Priority,
  type TaskStatus,
} from "@/lib/timelines";
import { ProgressBar, UpdateProgressButton } from "./progress";
import { DeleteTaskButton, StatusPicker } from "./row-controls";
import { EditTaskButton, type OwnerOption, type TaskRow } from "./task-forms";

export type TimelineTask = {
  id: number;
  area: string;
  title: string;
  lead: string | null;
  origin: string | null;
  priority: string;
  status: string;
  progress: number | null;
  starts_on: string | null;
  ends_on: string | null;
  schedule_note: string | null;
  comments: string | null;
  recurrence?: string | null;
  owner_id: number | null;
  owner_name: string | null;
  progress_note: string | null;
  progress_updated_at: string | null;
  progress_updated_by_name: string | null;
  /** Set when the row is a project follow-up action shown here read-only. */
  project: { id: number; title: string } | null;
};

type ViewMode = "table" | "board" | "schedule";
const VIEW_MODES: readonly ViewMode[] = ["table", "board", "schedule"];
const STATUS_FILTERS = [...TASK_STATUSES, "OVERDUE", "DUE_SOON"] as const;
const PAGE_SIZE = 20;
const DUE_SOON_DAYS = 14;

/** Areas come from workbook sheet names, so their colours are handed out in order. */
const AREA_TONES = [
  "border-sky-200 bg-sky-50 text-sky-800",
  "border-violet-200 bg-violet-50 text-violet-800",
  "border-amber-200 bg-amber-50 text-amber-800",
  "border-teal-200 bg-teal-50 text-teal-800",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  "border-lime-200 bg-lime-50 text-lime-800",
];

/** Bar colours in the schedule follow the status chips. */
const STATUS_BAR: Record<TaskStatus, { track: string; fill: string; dot: string }> = {
  NOT_STARTED: { track: "bg-ink/10", fill: "bg-ink/35", dot: "bg-ink/35" },
  ONGOING: { track: "bg-iica-600/20", fill: "bg-iica-600", dot: "bg-iica-600" },
  DELAYED: { track: "bg-rose-500/20", fill: "bg-rose-500", dot: "bg-rose-500" },
  COMPLETE: { track: "bg-emerald-500/25", fill: "bg-emerald-500", dot: "bg-emerald-500" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayNumber(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);
}

function daysBetween(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey);
}

function formatDay(key: string, withYear: boolean): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function whenLabel(t: TimelineTask, thisYear: number): string {
  const { starts_on: s, ends_on: e } = t;
  const showYear =
    (s && Number(s.slice(0, 4)) !== thisYear) ||
    (e && Number(e.slice(0, 4)) !== thisYear) ||
    (s && e && s.slice(0, 4) !== e.slice(0, 4));
  if (s && e && s !== e) return `${formatDay(s, Boolean(showYear))} to ${formatDay(e, Boolean(showYear))}`;
  if (s) return formatDay(s, Boolean(showYear));
  if (e) return `Due ${formatDay(e, Boolean(showYear))}`;
  return t.schedule_note ?? "No date set";
}

/** The date a task is judged against: its end, or its only date. */
function dueKey(t: TimelineTask): string | null {
  return t.ends_on ?? t.starts_on;
}

type DueState = { kind: "overdue" | "soon" | "later"; days: number } | null;

function dueState(t: TimelineTask, todayKey: string): DueState {
  if (t.status === "COMPLETE") return null;
  const due = dueKey(t);
  if (!due) return null;
  const days = daysBetween(todayKey, due);
  if (days < 0) return { kind: "overdue", days };
  if (days <= DUE_SOON_DAYS) return { kind: "soon", days };
  return { kind: "later", days };
}

function dueText(state: DueState): string | null {
  if (!state) return null;
  if (state.kind === "overdue") return `${Math.abs(state.days)}d overdue`;
  if (state.days === 0) return "Due today";
  return `Due in ${state.days}d`;
}

function DueBadge({ state }: { state: DueState }) {
  if (!state || state.kind === "later") return null;
  const overdue = state.kind === "overdue";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        overdue
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-gold-500/40 bg-gold-400/20 text-gold-700"
      }`}
    >
      {overdue && <AlertTriangle size={10} aria-hidden="true" />}
      {dueText(state)}
    </span>
  );
}

const REPEAT_LABEL: Record<string, string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly" };

function RepeatBadge({ recurrence }: { recurrence?: string | null }) {
  if (!recurrence || !REPEAT_LABEL[recurrence]) return null;
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800"
      title="Completing this task creates the next one"
    >
      <Repeat size={10} aria-hidden="true" /> {REPEAT_LABEL[recurrence]}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status as TaskStatus];
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta?.chip ?? ""}`}
    >
      {meta?.label ?? status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  if (!isPriority(priority)) return null;
  const meta = PRIORITY_META[priority as Priority];
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}

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

export function TimelinesView({
  tasks,
  areaNames,
  canManage,
  userId,
  owners,
  inactiveOwners,
  todayKey,
}: {
  tasks: TimelineTask[];
  areaNames: string[];
  canManage: boolean;
  userId: number;
  owners: OwnerOption[];
  inactiveOwners: OwnerOption[];
  todayKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const thisYear = Number(todayKey.slice(0, 4));

  const rawView = (searchParams.get("view") ?? "table").toLowerCase();
  const viewMode: ViewMode = (VIEW_MODES as readonly string[]).includes(rawView)
    ? (rawView as ViewMode)
    : "table";

  const rawArea = searchParams.get("area");
  const areaFilter = rawArea && areaNames.includes(rawArea) ? rawArea : null;

  const rawStatus = (searchParams.get("status") ?? "").toUpperCase();
  const statusFilter = (STATUS_FILTERS as readonly string[]).includes(rawStatus) ? rawStatus : "";

  const rawPriority = (searchParams.get("priority") ?? "").toUpperCase();
  const priorityFilter = isPriority(rawPriority) ? rawPriority : "";

  const leadFilter = searchParams.get("lead") ?? "";
  const mine = searchParams.get("mine") === "1";
  const rawPage = Math.max(1, Math.trunc(Number(searchParams.get("page"))) || 1);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([thisYear]);
    for (const t of tasks) {
      if (t.starts_on) years.add(Number(t.starts_on.slice(0, 4)));
      if (t.ends_on) years.add(Number(t.ends_on.slice(0, 4)));
    }
    return [...years].filter(Number.isFinite).sort((a, b) => a - b);
  }, [tasks, thisYear]);
  const rawYear = Number(searchParams.get("year"));
  const scheduleYear = yearOptions.includes(rawYear) ? rawYear : thisYear;

  const urlQ = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(urlQ);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSearchTimer = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  useEffect(() => setSearchInput(urlQ), [urlQ]);

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      cancelSearchTimer();
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const query = next.toString();
      router.replace(query ? `/timelines?${query}` : "/timelines", { scroll: false });
    },
    [cancelSearchTimer, router, searchParams],
  );

  useEffect(() => {
    if (searchInput === urlQ) return;
    cancelSearchTimer();
    searchTimerRef.current = setTimeout(
      () => updateUrl({ q: searchInput.trim() || null, page: null }),
      200,
    );
    return cancelSearchTimer;
  }, [searchInput, urlQ, updateUrl, cancelSearchTimer]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Ticked rows for bulk changes (managers only; project actions can't be ticked).
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const toggleTick = (id: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const asideRef = useRef<HTMLElement | null>(null);

  const selectTask = (id: number) => {
    setSelectedId(id);
    // On narrow screens the inspector sits under the list, so bring it into view.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        asideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const areaTone = useMemo(() => {
    const map = new Map<string, string>();
    areaNames.forEach((a, i) => map.set(a, AREA_TONES[i % AREA_TONES.length]));
    return (area: string) => map.get(area) ?? AREA_TONES[0];
  }, [areaNames]);

  const leadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.owner_name) set.add(t.owner_name);
      if (t.lead) set.add(t.lead);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const queryTerm = searchInput.trim().toLowerCase();

  const matchesBase = useCallback(
    (t: TimelineTask) => {
      if (mine && t.owner_id !== userId) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (leadFilter && t.lead !== leadFilter && t.owner_name !== leadFilter) return false;
      if (queryTerm) {
        const hay = `${t.title} ${t.lead ?? ""} ${t.owner_name ?? ""} ${t.origin ?? ""} ${
          t.comments ?? ""
        } ${t.schedule_note ?? ""} ${t.progress_note ?? ""} ${areaLabel(t.area)}`.toLowerCase();
        if (!hay.includes(queryTerm)) return false;
      }
      return true;
    },
    [mine, userId, priorityFilter, leadFilter, queryTerm],
  );

  const matchesStatus = useCallback(
    (t: TimelineTask) => {
      if (!statusFilter) return true;
      if (statusFilter === "OVERDUE") return dueState(t, todayKey)?.kind === "overdue";
      if (statusFilter === "DUE_SOON") return dueState(t, todayKey)?.kind === "soon";
      return t.status === statusFilter;
    },
    [statusFilter, todayKey],
  );

  // Area pill counts reflect every other filter, so they always match what a click will show.
  const preArea = useMemo(
    () => tasks.filter((t) => matchesBase(t) && matchesStatus(t)),
    [tasks, matchesBase, matchesStatus],
  );
  const areaCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of preArea) counts[t.area] = (counts[t.area] ?? 0) + 1;
    return counts;
  }, [preArea]);

  // Footer status counts ignore the status filter, so each one is a usable shortcut.
  const preStatus = useMemo(
    () => tasks.filter((t) => matchesBase(t) && (!areaFilter || t.area === areaFilter)),
    [tasks, matchesBase, areaFilter],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { OVERDUE: 0, DUE_SOON: 0 };
    for (const t of preStatus) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
      const due = dueState(t, todayKey);
      if (due?.kind === "overdue") counts.OVERDUE += 1;
      if (due?.kind === "soon") counts.DUE_SOON += 1;
    }
    return counts;
  }, [preStatus, todayKey]);

  const filtered = useMemo(
    () => (areaFilter ? preArea.filter((t) => t.area === areaFilter) : preArea),
    [preArea, areaFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(rawPage, totalPages);
  const pageTasks = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selected = selectedId !== null ? (tasks.find((t) => t.id === selectedId) ?? null) : null;

  const attention = useMemo(
    () =>
      preStatus
        .map((t) => ({ t, due: dueState(t, todayKey) }))
        .filter(
          ({ t, due }) =>
            due?.kind === "overdue" || due?.kind === "soon" || t.status === "DELAYED",
        )
        .sort((a, b) => (a.due?.days ?? 9999) - (b.due?.days ?? 9999)),
    [preStatus, todayKey],
  );

  const hasActiveFilters = Boolean(
    areaFilter || statusFilter || priorityFilter || leadFilter || mine || searchInput.trim(),
  );
  const clearAll = () => {
    setSearchInput("");
    updateUrl({ area: null, status: null, priority: null, lead: null, mine: null, q: null, page: null });
  };

  const ownersFor = (ownerId: number | null): OwnerOption[] => {
    if (!ownerId || owners.some((o) => o.id === ownerId)) return owners;
    const gone = inactiveOwners.find((o) => o.id === ownerId);
    return gone ? [gone, ...owners] : owners;
  };

  const toRow = (t: TimelineTask): TaskRow => ({
    id: t.id,
    area: t.area,
    owner_id: t.owner_id,
    title: t.title,
    lead: t.lead,
    origin: t.origin,
    priority: t.priority,
    status: t.status,
    progress: t.progress,
    starts_on: t.starts_on,
    ends_on: t.ends_on,
    schedule_note: t.schedule_note,
    comments: t.comments,
    recurrence: t.recurrence ?? null,
  });

  const formAreas = areaNames.filter((a) => a !== PROJECT_AREA);
  const canUpdate = (t: TimelineTask) => !t.project && (canManage || t.owner_id === userId);
  const canChangeStatus = (t: TimelineTask) => canManage && !t.project;

  const taskActions = (t: TimelineTask) =>
    t.project ? (
      <Link
        href={`/projects/${t.project.id}?tab=actions`}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold text-iica-700 hover:bg-iica-50"
      >
        Open project <ArrowUpRight size={12} aria-hidden="true" />
      </Link>
    ) : canUpdate(t) ? (
      <RowActions>
        <UpdateProgressButton
          id={t.id}
          title={t.title}
          progress={t.progress}
          note={t.progress_note}
          status={t.status}
          owned={t.owner_id === userId}
        />
        {canManage && <EditTaskButton task={toRow(t)} areas={formAreas} owners={ownersFor(t.owner_id)} />}
        {canManage && <DeleteTaskButton id={t.id} title={t.title} />}
      </RowActions>
    ) : null;

  const heading = areaFilter ? areaLabel(areaFilter) : "All timelines";
  const subheading = [
    mine ? "Assigned to you" : null,
    statusFilter === "OVERDUE"
      ? "Overdue"
      : statusFilter === "DUE_SOON"
        ? `Due in the next ${DUE_SOON_DAYS} days`
        : statusFilter
          ? STATUS_META[statusFilter as TaskStatus].label
          : null,
    priorityFilter ? `${PRIORITY_META[priorityFilter as Priority].label} priority` : null,
    leadFilter || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const transitionKey = `${viewMode}-${areaFilter ?? "all"}-${statusFilter}-${priorityFilter}-${leadFilter}-${mine}-${safePage}-${scheduleYear}`;
  // A filter change can hide ticked rows, so ticks never outlive the view they were made in.
  useEffect(() => setTicked(new Set()), [transitionKey]);

  const emptyState = (
    <EmptyState
      icon={<ListChecks size={20} />}
      title={
        tasks.length === 0
          ? "No timelines yet"
          : mine && !statusFilter && !priorityFilter && !leadFilter && !queryTerm
            ? "No tasks assigned to your account"
            : "Nothing matches those filters"
      }
      description={
        tasks.length === 0
          ? "Import the targets and timelines workbook, or add a task by hand."
          : mine
            ? "Imported tasks may still need linking to individual user accounts."
            : "Try a different area, status or lead."
      }
      action={
        hasActiveFilters ? (
          <button type="button" onClick={clearAll} className="btn btn-ghost text-xs">
            Clear filters
          </button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-4">
      {/* 1. Area pills & inline filters */}
      <div className="flex flex-col gap-2.5 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={areaFilter ?? ""}
            onChange={(v) => updateUrl({ area: v || null, page: null })}
            className="w-full sm:w-auto sm:min-w-[12rem]"
            ariaLabel="Filter by area"
            options={[
              { value: "", label: "All areas", count: preArea.length },
              ...areaNames.map((a) => ({ value: a, label: areaLabel(a), count: areaCounts[a] ?? 0 })),
            ]}
          />
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => updateUrl({ mine: mine ? null : "1", page: null })}
            className={pillClass(mine)}
          >
            <UserCheck size={13} aria-hidden="true" />
            <span>Assigned to me</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:w-56 sm:flex-none">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/55"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search tasks, leads, notes…"
              aria-label="Search tasks"
              className="field py-1.5 pr-7 pl-8 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput("");
                  updateUrl({ q: null, page: null });
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/55 hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <FilterSelect
            value={statusFilter}
            onChange={(v) => updateUrl({ status: v || null, page: null })}
            className="min-w-[9rem]"
            ariaLabel="Filter by status"
            options={[
              { value: "", label: "All statuses" },
              ...TASK_STATUSES.map((st) => ({ value: st, label: STATUS_META[st].label })),
              { value: "OVERDUE", label: "Overdue" },
              { value: "DUE_SOON", label: `Due in ${DUE_SOON_DAYS} days` },
            ]}
          />

          <FilterSelect
            value={priorityFilter}
            onChange={(v) => updateUrl({ priority: v || null, page: null })}
            className="min-w-[8.5rem]"
            ariaLabel="Filter by priority"
            options={[{ value: "", label: "Any priority" }, ...PRIORITIES.map((pr) => ({ value: pr, label: PRIORITY_META[pr].label }))]}
          />

          <FilterSelect
            value={leadFilter}
            onChange={(v) => updateUrl({ lead: v || null, page: null })}
            className="min-w-[9rem] max-w-[13rem]"
            ariaLabel="Filter by lead"
            options={[{ value: "", label: "Every lead" }, ...leadOptions.map((l) => ({ value: l, label: l }))]}
          />

          <SavedViews page="timelines" />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* 2. Workspace + inspector, laid out like the calendar */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="panel relative min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink">{heading}</h2>
              {subheading && <p className="mt-0.5 text-xs text-ink/60">{subheading}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {viewMode === "schedule" && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Previous year"
                    disabled={yearOptions.indexOf(scheduleYear) <= 0}
                    onClick={() => {
                      const i = yearOptions.indexOf(scheduleYear);
                      if (i > 0) updateUrl({ year: String(yearOptions[i - 1]) });
                    }}
                    className="rounded-lg border border-ink/12 bg-white p-1.5 text-ink/65 transition hover:bg-iica-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="min-w-[3.25rem] text-center text-xs font-semibold tabular-nums text-ink">
                    {scheduleYear}
                  </span>
                  <button
                    type="button"
                    aria-label="Next year"
                    disabled={yearOptions.indexOf(scheduleYear) >= yearOptions.length - 1}
                    onClick={() => {
                      const i = yearOptions.indexOf(scheduleYear);
                      if (i < yearOptions.length - 1) updateUrl({ year: String(yearOptions[i + 1]) });
                    }}
                    className="rounded-lg border border-ink/12 bg-white p-1.5 text-ink/65 transition hover:bg-iica-50 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}

              <div role="group" aria-label="Timelines display mode" className="flex items-center gap-1">
                {(
                  [
                    { id: "table", label: "Table", icon: <Table2 size={13} aria-hidden="true" /> },
                    { id: "board", label: "Board", icon: <Columns3 size={13} aria-hidden="true" /> },
                    { id: "schedule", label: "Schedule", icon: <CalendarRange size={13} aria-hidden="true" /> },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={viewMode === m.id}
                    onClick={() => updateUrl({ view: m.id === "table" ? null : m.id, page: null })}
                    className={modeClass(viewMode === m.id)}
                  >
                    {m.icon}
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-4">{emptyState}</div>
          ) : viewMode === "table" ? (
            <div key={transitionKey} className="animate-fade overflow-x-auto">
              {/* Phones get a stacked list; the table needs more width than they have. */}
              <ul className="divide-y divide-ink/8 md:hidden">
                {pageTasks.map((t) => {
                  const due = dueState(t, todayKey);
                  return (
                    <li key={t.id} className={`px-4 py-3.5 ${selected?.id === t.id ? "bg-iica-50/75" : ""}`}>
                      <button type="button" onClick={() => selectTask(t.id)} className="block w-full text-left">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={t.status} />
                          <PriorityChip priority={t.priority} />
                          <DueBadge state={due} />
                          <RepeatBadge recurrence={t.recurrence} />
                        </div>
                        <div className="mt-1.5 text-sm font-semibold text-ink">{t.title}</div>
                        <div className="mt-0.5 text-xs text-ink/60">
                          {[!areaFilter ? areaLabel(t.area) : null, t.owner_name ?? t.lead, whenLabel(t, thisYear)]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </button>
                      {t.progress !== null && (
                        <div className="mt-2">
                          <ProgressBar progress={t.progress} note={t.progress_note} />
                        </div>
                      )}
                      {(canUpdate(t) || t.project) && <div className="mt-1.5">{taskActions(t)}</div>}
                    </li>
                  );
                })}
              </ul>
              {canManage && ticked.size > 0 && (
                <BulkBar ids={[...ticked]} owners={owners} onDone={() => setTicked(new Set())} />
              )}
              <table className="table-shell hidden w-full md:table [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
                <thead>
                  <tr>
                    {canManage && (
                      <th className="w-10 !pr-0">
                        <input
                          type="checkbox"
                          aria-label="Select every task on this page"
                          className="h-4 w-4 rounded border-ink/30 accent-iica-700"
                          checked={pageTasks.some((t) => !t.project) && pageTasks.filter((t) => !t.project).every((t) => ticked.has(t.id))}
                          onChange={(e) =>
                            setTicked(e.target.checked ? new Set(pageTasks.filter((t) => !t.project).map((t) => t.id)) : new Set())
                          }
                        />
                      </th>
                    )}
                    <th>Task</th>
                    <th>Lead</th>
                    <th>When</th>
                    <th>Priority</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th className="w-28 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageTasks.map((t) => {
                    const due = dueState(t, todayKey);
                    const isSelected = selected?.id === t.id;
                    return (
                      <tr key={t.id} className={isSelected || ticked.has(t.id) ? "bg-iica-50/75" : ""}>
                        {canManage && (
                          <td className="w-10 !pr-0">
                            {!t.project && (
                              <input
                                type="checkbox"
                                aria-label={`Select ${t.title}`}
                                className="h-4 w-4 rounded border-ink/30 accent-iica-700"
                                checked={ticked.has(t.id)}
                                onChange={() => toggleTick(t.id)}
                              />
                            )}
                          </td>
                        )}
                        <td className="min-w-[14rem]">
                          <button
                            type="button"
                            onClick={() => selectTask(t.id)}
                            className="text-left font-semibold text-ink hover:text-iica-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
                          >
                            {t.title}
                          </button>
                          {(!areaFilter || t.recurrence) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {!areaFilter && (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${areaTone(t.area)}`}
                                >
                                  {areaLabel(t.area)}
                                </span>
                              )}
                              <RepeatBadge recurrence={t.recurrence} />
                            </div>
                          )}
                        </td>
                        <td className="text-xs text-ink/70">
                          <div className="font-medium text-ink/85">{t.owner_name ?? t.lead ?? "-"}</div>
                          {t.owner_name && t.lead && t.lead !== t.owner_name && (
                            <div className="text-[11px] text-ink/50">{t.lead}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs text-ink/70">
                          <div>{whenLabel(t, thisYear)}</div>
                          {due && due.kind !== "later" && (
                            <div
                              className={`text-[11px] font-medium ${
                                due.kind === "overdue" ? "text-rose-700" : "text-gold-700"
                              }`}
                            >
                              {dueText(due)}
                            </div>
                          )}
                        </td>
                        <td>
                          <PriorityChip priority={t.priority} />
                        </td>
                        <td>
                          <ProgressBar
                            progress={t.progress}
                            note={t.progress_note}
                            updatedBy={t.progress_updated_by_name}
                            updatedAt={t.progress_updated_at}
                          />
                        </td>
                        <td>
                          {canChangeStatus(t) ? (
                            <StatusPicker id={t.id} title={t.title} status={t.status} progress={t.progress} />
                          ) : (
                            <StatusChip status={t.status} />
                          )}
                        </td>
                        <td>{taskActions(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination
                page={safePage}
                perPage={PAGE_SIZE}
                total={filtered.length}
                basePath="/timelines"
                params={{
                  area: areaFilter ?? undefined,
                  status: statusFilter || undefined,
                  priority: priorityFilter || undefined,
                  lead: leadFilter || undefined,
                  mine: mine ? "1" : undefined,
                  q: urlQ || undefined,
                }}
              />
            </div>
          ) : viewMode === "board" ? (
            <div key={transitionKey} className="animate-fade grid gap-3 p-4 sm:grid-cols-2 sm:p-5 2xl:grid-cols-4">
              {TASK_STATUSES.map((status) => {
                const column = filtered.filter((t) => t.status === status);
                return (
                  <section
                    key={status}
                    aria-label={STATUS_META[status].label}
                    className="flex min-w-0 flex-col rounded-2xl border border-ink/8 bg-iica-50/30"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-ink/8 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                        <span className={`h-2 w-2 rounded-full ${STATUS_BAR[status].dot}`} aria-hidden="true" />
                        {STATUS_META[status].label}
                      </span>
                      <span className="rounded-full bg-ink/6 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink/65">
                        {column.length}
                      </span>
                    </div>
                    <div className="max-h-[68vh] space-y-2 overflow-y-auto p-2.5">
                      {column.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] text-ink/45">Nothing here</p>
                      ) : (
                        column.map((t) => {
                          const due = dueState(t, todayKey);
                          const isSelected = selected?.id === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => selectTask(t.id)}
                              className={`block w-full rounded-xl border p-3 text-left transition ${
                                isSelected
                                  ? "border-iica-700 bg-white ring-2 ring-iica-600/20"
                                  : "border-ink/10 bg-white hover:border-iica-300"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                {!areaFilter && (
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${areaTone(t.area)}`}
                                  >
                                    {areaLabel(t.area)}
                                  </span>
                                )}
                                <PriorityChip priority={t.priority} />
                                <DueBadge state={due} />
                                <RepeatBadge recurrence={t.recurrence} />
                              </div>
                              <div className="mt-2 text-sm font-semibold leading-snug text-ink">{t.title}</div>
                              <div className="mt-2 space-y-1 text-[11px] text-ink/60">
                                {(t.owner_name || t.lead) && (
                                  <div className="flex items-center gap-1.5 truncate">
                                    <User size={11} className="shrink-0 text-ink/45" aria-hidden="true" />
                                    <span className="truncate">{t.owner_name ?? t.lead}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 truncate">
                                  <CalendarClock size={11} className="shrink-0 text-ink/45" aria-hidden="true" />
                                  <span className="truncate">{whenLabel(t, thisYear)}</span>
                                </div>
                              </div>
                              {t.progress !== null && (
                                <div className="mt-2.5 border-t border-ink/8 pt-2">
                                  <ProgressBar progress={t.progress} />
                                </div>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <ScheduleView
              key={transitionKey}
              tasks={filtered}
              year={scheduleYear}
              todayKey={todayKey}
              groupByArea={!areaFilter}
              selectedId={selected?.id ?? null}
              onSelect={selectTask}
              areaTone={areaTone}
            />
          )}

          {/* Footer: status legend doubles as quick filters, total on the right */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-3.5 py-3 text-xs text-ink/60 sm:px-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {[...TASK_STATUSES, "OVERDUE" as const].map((key) => {
                const active = statusFilter === key;
                const label = key === "OVERDUE" ? "Overdue" : STATUS_META[key].label;
                const dot = key === "OVERDUE" ? "bg-rose-600" : STATUS_BAR[key].dot;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateUrl({ status: active ? null : key, page: null })}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? "border-iica-700 bg-iica-700 text-white"
                        : "border-ink/10 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : dot}`} aria-hidden="true" />
                    {label}
                    <span className="tabular-nums opacity-75">{statusCounts[key] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
              <span>Total tasks:</span>
              <span className="font-semibold text-ink tabular-nums">{filtered.length}</span>
            </div>
          </div>
        </div>

        {/* Right: task inspector, or what needs attention when nothing is selected */}
        <aside ref={asideRef} className="panel scroll-mt-4 overflow-hidden">
          {selected ? (
            <TaskInspector
              key={selected.id}
              task={selected}
              thisYear={thisYear}
              todayKey={todayKey}
              areaTone={areaTone(selected.area)}
              canManage={canManage && !selected.project}
              actions={taskActions(selected)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="animate-fade p-5">
              <div className="flex items-center gap-2 border-b border-ink/8 pb-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                  <Flag size={15} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">Needs attention</h3>
                  <p className="text-[11px] text-ink/60">
                    Overdue, delayed or due in the next {DUE_SOON_DAYS} days
                  </p>
                </div>
              </div>
              {attention.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink/55">
                  Nothing overdue or due soon. Select a task to see its details.
                </p>
              ) : (
                <ul className="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
                  {attention.slice(0, 25).map(({ t, due }) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => selectTask(t.id)}
                        className="flex w-full items-start gap-2.5 rounded-xl border border-ink/8 bg-white px-3 py-2.5 text-left transition hover:border-iica-300 hover:bg-iica-50/40"
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            due?.kind === "overdue"
                              ? "bg-rose-600"
                              : t.status === "DELAYED"
                                ? "bg-rose-400"
                                : "bg-gold-500"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-xs font-semibold text-ink">{t.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-ink/55">
                            {[t.owner_name ?? t.lead, dueText(due) ?? STATUS_META[t.status as TaskStatus]?.label]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {attention.length > 25 && (
                    <li className="pt-1 text-center text-[11px] text-ink/55">
                      +{attention.length - 25} more. Filter by Overdue to see them all.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TaskInspector({
  task: t,
  thisYear,
  todayKey,
  areaTone,
  canManage,
  actions,
  onClose,
}: {
  task: TimelineTask;
  thisYear: number;
  todayKey: string;
  areaTone: string;
  canManage: boolean;
  actions: React.ReactNode;
  onClose: () => void;
}) {
  const due = dueState(t, todayKey);
  const span =
    t.starts_on && t.ends_on && t.ends_on > t.starts_on ? daysBetween(t.starts_on, t.ends_on) + 1 : null;

  return (
    <div className="animate-fade space-y-4 p-5">
      <div className="flex items-start justify-between gap-2 border-b border-ink/8 pb-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${areaTone}`}>
              {areaLabel(t.area)}
            </span>
            <PriorityChip priority={t.priority} />
            <DueBadge state={due} />
            <RepeatBadge recurrence={t.recurrence} />
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug text-ink">{t.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink/45 transition hover:bg-ink/5 hover:text-ink"
          title="Back to needs attention"
          aria-label="Close task details"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-2.5 rounded-xl border border-ink/8 bg-iica-50/45 p-3.5 text-xs">
        <div className="flex items-start gap-2.5">
          <CalendarClock size={15} className="mt-0.5 shrink-0 text-iica-700" aria-hidden="true" />
          <div>
            <div className="font-semibold text-ink">{whenLabel(t, thisYear)}</div>
            <div className="mt-0.5 text-ink/65">
              {[span ? `${span} days` : null, t.starts_on || t.ends_on ? t.schedule_note : null]
                .filter(Boolean)
                .join(" · ") || (due ? dueText(due) : "No target date")}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2.5 border-t border-ink/6 pt-2.5">
          <User size={15} className="mt-0.5 shrink-0 text-iica-700" aria-hidden="true" />
          <div>
            <div className="font-semibold text-ink">{t.owner_name ?? t.lead ?? "No lead set"}</div>
            {t.owner_name && t.lead && t.lead !== t.owner_name && (
              <div className="mt-0.5 text-ink/65">Lead in workbook: {t.lead}</div>
            )}
            {!t.owner_name && t.lead && (
              <div className="mt-0.5 text-ink/55">Not linked to a user account</div>
            )}
          </div>
        </div>
        {t.origin && (
          <div className="flex items-start gap-2.5 border-t border-ink/6 pt-2.5">
            <Compass size={15} className="mt-0.5 shrink-0 text-iica-700" aria-hidden="true" />
            <div>
              <div className="text-ink/55">{t.project ? "Project" : "Origin"}</div>
              <div className="font-medium text-ink">{t.origin}</div>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <GaugeCircle size={13} className="text-iica-700" aria-hidden="true" /> Progress
          </span>
          {canManage ? (
            <StatusPicker id={t.id} title={t.title} status={t.status} progress={t.progress} />
          ) : (
            <StatusChip status={t.status} />
          )}
        </div>
        <ProgressBar progress={t.progress} />
        {t.progress_note && <p className="mt-2 text-xs text-ink/75">{t.progress_note}</p>}
        {t.progress_updated_by_name && t.progress_updated_at && (
          <p className="mt-1 text-[11px] text-ink/50">
            Updated by {t.progress_updated_by_name} on {formatDay(t.progress_updated_at, true)}
          </p>
        )}
      </div>

      {t.comments && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <MessageSquareText size={13} className="text-iica-700" aria-hidden="true" /> Comments
          </div>
          <p className="whitespace-pre-line text-xs leading-relaxed text-ink/75">{t.comments}</p>
        </div>
      )}

      {!t.project && (
        <div className="border-t border-ink/8 pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <MessagesSquare size={13} className="text-iica-700" aria-hidden="true" /> Discussion
          </div>
          <CommentThread type="task" id={t.id} compact />
        </div>
      )}

      {actions && (
        <div className="flex items-center justify-between gap-2 border-t border-ink/8 pt-3">
          <span className="text-[11px] text-ink/55">Update, edit or remove</span>
          {actions}
        </div>
      )}
    </div>
  );
}

function ScheduleView({
  tasks,
  year,
  todayKey,
  groupByArea,
  selectedId,
  onSelect,
  areaTone,
}: {
  tasks: TimelineTask[];
  year: number;
  todayKey: string;
  groupByArea: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  areaTone: (area: string) => string;
}) {
  const yearStart = dayNumber(`${year}-01-01`);
  const yearDays = dayNumber(`${year + 1}-01-01`) - yearStart;
  const pct = (key: string) => ((dayNumber(key) - yearStart) / yearDays) * 100;
  const monthStarts = MONTHS.map((_, i) => pct(`${year}-${String(i + 1).padStart(2, "0")}-01`));
  const todayPct = Number(todayKey.slice(0, 4)) === year ? pct(todayKey) : null;

  const inYear = tasks.filter((t) => {
    const s = t.starts_on ?? t.ends_on;
    const e = t.ends_on ?? t.starts_on;
    if (!s || !e) return false;
    return Number(s.slice(0, 4)) <= year && Number(e.slice(0, 4)) >= year;
  });
  const undated = tasks.filter((t) => !t.starts_on && !t.ends_on).length;

  const groups: [string, TimelineTask[]][] = groupByArea
    ? [...new Set(inYear.map((t) => t.area))].map((a) => [a, inYear.filter((t) => t.area === a)])
    : [["", inYear]];

  const grid = (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {monthStarts.slice(1).map((left, i) => (
        <span key={i} className="absolute inset-y-0 w-px bg-ink/6" style={{ left: `${left}%` }} />
      ))}
      {todayPct !== null && (
        <span className="absolute inset-y-0 w-0.5 bg-rose-500/70" style={{ left: `${todayPct}%` }} />
      )}
    </div>
  );

  return (
    <div className="animate-fade">
      {inYear.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-ink/10 bg-iica-50 text-iica-700">
            <CalendarRange size={20} />
          </div>
          <div className="text-sm font-semibold text-ink">No dated tasks in {year}</div>
          <p className="mt-1 text-xs text-ink/60">Pick another year above, or add dates to tasks.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Month header */}
            <div className="grid grid-cols-[15rem_minmax(0,1fr)] border-b border-ink/8 bg-iica-50/40 text-[11px] font-semibold text-ink/60">
              <div className="px-4 py-2">Task</div>
              <div className="relative h-8">
                {MONTHS.map((m, i) => (
                  <span
                    key={m}
                    className="absolute top-1/2 -translate-y-1/2 pl-1.5"
                    style={{ left: `${monthStarts[i]}%` }}
                  >
                    {m}
                  </span>
                ))}
                {todayPct !== null && (
                  <span
                    className="absolute -top-0 rounded-b bg-rose-500 px-1 text-[9px] font-semibold text-white"
                    style={{ left: `${todayPct}%`, transform: "translateX(-50%)" }}
                  >
                    Today
                  </span>
                )}
              </div>
            </div>

            {groups.map(([area, rows]) => (
              <div key={area || "all"}>
                {groupByArea && (
                  <div className="border-b border-ink/8 bg-white px-4 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${areaTone(area)}`}>
                      {areaLabel(area)} · {rows.length}
                    </span>
                  </div>
                )}
                {rows.map((t) => {
                  const status = (STATUS_BAR[t.status as TaskStatus] ? t.status : "NOT_STARTED") as TaskStatus;
                  const tone = STATUS_BAR[status];
                  const s = t.starts_on ?? t.ends_on!;
                  const e = t.ends_on ?? t.starts_on!;
                  const single = s === e;
                  const left = Math.max(0, pct(s));
                  const right = Math.min(100, pct(e) + 100 / yearDays);
                  const width = Math.max(0.8, right - left);
                  const due = dueState(t, todayKey);
                  const isSelected = selectedId === t.id;
                  const label = `${t.title}: ${whenLabel(t, year)} · ${STATUS_META[status].label}${
                    t.progress !== null ? ` · ${t.progress}%` : ""
                  }`;
                  return (
                    <div
                      key={t.id}
                      className={`grid grid-cols-[15rem_minmax(0,1fr)] border-b border-ink/6 last:border-b-0 ${
                        isSelected ? "bg-iica-50/70" : "hover:bg-iica-50/30"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(t.id)}
                        className="min-w-0 px-4 py-2 text-left"
                      >
                        <span className="block truncate text-xs font-semibold text-ink hover:text-iica-700">
                          {t.title}
                        </span>
                        <span className="block truncate text-[11px] text-ink/55">
                          {[t.owner_name ?? t.lead, dueText(due)].filter(Boolean).join(" · ") || " "}
                        </span>
                      </button>
                      <div className="relative">
                        {grid}
                        <button
                          type="button"
                          onClick={() => onSelect(t.id)}
                          title={label}
                          aria-label={label}
                          className="absolute top-1/2 -translate-y-1/2"
                          style={
                            single
                              ? { left: `${left}%`, transform: "translate(-50%, -50%)" }
                              : { left: `${left}%`, width: `${width}%` }
                          }
                        >
                          {single ? (
                            <span
                              className={`block h-3 w-3 rotate-45 rounded-[3px] ${tone.fill} ${
                                due?.kind === "overdue" ? "ring-2 ring-rose-300" : ""
                              }`}
                            />
                          ) : (
                            <span
                              className={`relative block h-3.5 overflow-hidden rounded-full ${tone.track} ${
                                isSelected ? "ring-2 ring-iica-600/40" : ""
                              } ${due?.kind === "overdue" ? "ring-2 ring-rose-300" : ""}`}
                            >
                              <span
                                className={`absolute inset-y-0 left-0 rounded-full ${tone.fill}`}
                                style={{
                                  width: `${
                                    status === "COMPLETE" ? 100 : Math.max(t.progress ?? 0, 6)
                                  }%`,
                                }}
                              />
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {undated > 0 && (
        <p className="border-t border-ink/8 px-4 py-2.5 text-[11px] text-ink/55">
          {undated} task{undated === 1 ? " has" : "s have"} no dates and {undated === 1 ? "is" : "are"} not
          shown here. Switch to Table to see {undated === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}
