"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { CalendarOptions, EventContentArg } from "@fullcalendar/core";
import type FullCalendar from "@fullcalendar/react";
import {
  Calendar as CalendarIcon,
  CalendarCheck2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  LayoutList,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { Modal } from "@/components/modal";
import { deleteCalendarEventAction, type CalendarState } from "./actions";
import {
  EventFormFields,
  useCalendarHeaderContext,
  type EditableCalendarEvent,
  type StaffOption,
} from "./event-form";

export type CalendarEventItem = EditableCalendarEvent;

export type CalendarSyncMeta = {
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt: string | null;
};

type DynamicFullCalendarProps = CalendarOptions & {
  fcRef: React.RefObject<FullCalendar | null>;
  initialViewType: string;
};

const DynamicFullCalendar = dynamic<DynamicFullCalendarProps>(
  async () => {
    const [
      { default: FC },
      { default: dayGridPlugin },
      { default: timeGridPlugin },
      { default: interactionPlugin },
    ] = await Promise.all([
      import("@fullcalendar/react"),
      import("@fullcalendar/daygrid"),
      import("@fullcalendar/timegrid"),
      import("@fullcalendar/interaction"),
    ]);
    return function LoadedFullCalendar({
      fcRef,
      initialViewType,
      ...options
    }: DynamicFullCalendarProps) {
      useEffect(() => {
        if (initialViewType !== "dayGridMonth") {
          const raf = requestAnimationFrame(() => {
            fcRef.current?.getApi()?.scrollToTime("07:30:00");
          });
          return () => cancelAnimationFrame(raf);
        }
      }, [fcRef, initialViewType]);

      return (
        <FC
          ref={fcRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={initialViewType}
          {...options}
        />
      );
    };
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[660px] items-center justify-center rounded-2xl border border-ink/10 bg-iica-50/30 text-xs font-medium text-ink/60">
        Loading calendar…
      </div>
    ),
  },
);

const AST_OFFSET_MS = 4 * 3600 * 1000;

const TYPES: Record<
  string,
  {
    label: string;
    shortLabel: string;
    accent: string;
    tint: string;
    border: string;
    text: string;
    badgeBg: string;
  }
> = {
  MEETING: {
    label: "Meeting",
    shortLabel: "Meetings",
    accent: "#2563eb",
    tint: "var(--cal-meeting-tint)",
    border: "var(--cal-meeting-border)",
    text: "var(--cal-meeting-text)",
    badgeBg: "bg-[var(--cal-meeting-tint)] text-[var(--cal-meeting-text)] border-[var(--cal-meeting-border)]",
  },
  MISSION: {
    label: "Mission",
    shortLabel: "Missions",
    accent: "#16a34a",
    tint: "var(--cal-mission-tint)",
    border: "var(--cal-mission-border)",
    text: "var(--cal-mission-text)",
    badgeBg: "bg-[var(--cal-mission-tint)] text-[var(--cal-mission-text)] border-[var(--cal-mission-border)]",
  },
  LEAVE: {
    label: "Leave & Vacation",
    shortLabel: "Leave",
    accent: "#64748b",
    tint: "var(--cal-leave-tint)",
    border: "var(--cal-leave-border)",
    text: "var(--cal-leave-text)",
    badgeBg: "bg-[var(--cal-leave-tint)] text-[var(--cal-leave-text)] border-[var(--cal-leave-border)]",
  },
  HOLIDAY: {
    label: "Holiday",
    shortLabel: "Holidays",
    accent: "#d97706",
    tint: "var(--cal-holiday-tint)",
    border: "var(--cal-holiday-border)",
    text: "var(--cal-holiday-text)",
    badgeBg: "bg-[var(--cal-holiday-tint)] text-[var(--cal-holiday-text)] border-[var(--cal-holiday-border)]",
  },
  DEADLINE: {
    label: "Deadline",
    shortLabel: "Deadlines",
    accent: "#dc2626",
    tint: "var(--cal-deadline-tint)",
    border: "var(--cal-deadline-border)",
    text: "var(--cal-deadline-text)",
    badgeBg: "bg-[var(--cal-deadline-tint)] text-[var(--cal-deadline-text)] border-[var(--cal-deadline-border)]",
  },
  PROJECT: {
    label: "Project",
    shortLabel: "Projects",
    accent: "#0d9488",
    tint: "var(--cal-project-tint)",
    border: "var(--cal-project-border)",
    text: "var(--cal-project-text)",
    badgeBg: "bg-[var(--cal-project-tint)] text-[var(--cal-project-text)] border-[var(--cal-project-border)]",
  },
  OTHER: {
    label: "General",
    shortLabel: "General",
    accent: "#7c3aed",
    tint: "var(--cal-other-tint)",
    border: "var(--cal-other-border)",
    text: "var(--cal-other-text)",
    badgeBg: "bg-[var(--cal-other-tint)] text-[var(--cal-other-text)] border-[var(--cal-other-border)]",
  },
};

const STAFF_NAME_BY_CODE: Record<string, string> = {
  DEF: "Diana Francis",
  DF: "Diana Francis",
  LH: "Lisa Harrynanan",
  RR: "Richard Rampersaud",
  MA: "Mercedes Archer",
  JL: "Junnel Lewis",
  GEH: "Geselle Hodge",
  GH: "Geselle Hodge",
  SE: "Salisha Estrada",
  VAB: "Veronica Alleyne-Bailey",
  VB: "Veronica Alleyne-Bailey",
  EF: "Edwin Franco",
  AD: "Akio Devenish",
  EC: "Earllene Crawford",
};

const STAFF_INITIAL_FILTERS: { code: string; name: string; aliases: string[] }[] = [
  { code: "DF", name: "Diana Francis", aliases: ["DF", "DEF"] },
  { code: "LH", name: "Lisa Harrynanan", aliases: ["LH"] },
  { code: "RR", name: "Richard Rampersaud", aliases: ["RR"] },
  { code: "MA", name: "Mercedes Archer", aliases: ["MA"] },
  { code: "JL", name: "Junnel Lewis", aliases: ["JL"] },
  { code: "GH", name: "Geselle Hodge", aliases: ["GH", "GEH"] },
  { code: "SE", name: "Salisha Estrada", aliases: ["SE"] },
  { code: "VAB", name: "Veronica Alleyne-Bailey", aliases: ["VAB", "VB"] },
  { code: "EF", name: "Edwin Franco", aliases: ["EF"] },
  { code: "AD", name: "Akio Devenish", aliases: ["AD"] },
  { code: "EC", name: "Earllene Crawford", aliases: ["EC"] },
];

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandStaffInitials(raw: string): string {
  if (!raw) return raw;
  const expandChunk = (segment: string) =>
    segment
      .replace(/\bTeam \/ Participants:/gi, "Participants:")
      .replace(/\bVACATION\b/g, "Vacation")
      .replace(/\bNattional Holiday\b/gi, "National Holiday")
      .replace(/\bOpertaions\b/gi, "Operations")
      .replace(/\bPortfilio\b/gi, "Portfolio")
      .replace(/\bInvititation\b/gi, "Invitation")
      .replace(/\bSTaff\b/g, "Staff")
      .replace(
        /(^|\s)-+(?=(?:DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)\b)/g,
        "$1",
      )
      .replace(
        /(?<![A-Za-z0-9/])(DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)(?![A-Za-z0-9/])/g,
        (code) => STAFF_NAME_BY_CODE[code] ?? code,
      )
      .replace(/[ \t]+,[ \t]*$/g, "")
      .replace(/[ \t]{2,}/g, " ");

  const urlRe = /(https?:\/\/[^\s<>"')\]]+)/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of raw.matchAll(urlRe)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      parts.push(expandChunk(raw.slice(lastIndex, idx)));
    }
    parts.push(match[0]);
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < raw.length) {
    parts.push(expandChunk(raw.slice(lastIndex)));
  }
  return parts.join("").replace(/[ \t]+\n/g, "\n").trim();
}

const toneFor = (type: string) => TYPES[type] ?? TYPES.OTHER;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toTrinidadWallDate(iso: string): Date {
  return new Date(new Date(iso).getTime() - AST_OFFSET_MS);
}

/** Converts an ISO date string to YYYY-MM-DD in Trinidad local time (America/Port_of_Spain, UTC-4). */
function trinidadDayKey(iso: string): string {
  return toTrinidadWallDate(iso).toISOString().slice(0, 10);
}

/** Converts an ISO timestamp to an unzoned AST wall-clock string for FullCalendar timeZone="UTC". */
function toTrinidadWallIso(iso: string): string {
  return toTrinidadWallDate(iso).toISOString().slice(0, 19);
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return { start: `${ym}-01`, end: `${ym}-${lastDay}` };
}

function eventOverlapsRange(ev: CalendarEventItem, rangeStart: string, rangeEnd: string): boolean {
  const startKey = trinidadDayKey(ev.starts_at);
  const endKey = trinidadDayKey(ev.ends_at);
  const effectiveEnd = endKey >= startKey ? endKey : startKey;
  return effectiveEnd >= rangeStart && startKey <= rangeEnd;
}

function formatTrinidadTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Port_of_Spain",
  });
}

function formatShortDay(dayKeyStr: string): string {
  return new Date(`${dayKeyStr}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTrinidadTimeRange(event: CalendarEventItem): string {
  const startKey = trinidadDayKey(event.starts_at);
  const endKey = trinidadDayKey(event.ends_at);
  const isMultiDay = endKey > startKey;
  if (event.all_day) {
    return isMultiDay ? `All day · ${formatShortDay(startKey)} – ${formatShortDay(endKey)}` : "All day";
  }
  const start = formatTrinidadTime(event.starts_at);
  const end = formatTrinidadTime(event.ends_at);
  if (isMultiDay) {
    return `${formatShortDay(startKey)}, ${start} – ${formatShortDay(endKey)}, ${end}`;
  }
  return start === end ? start : `${start} – ${end}`;
}

function formatDayHeading(dayKeyStr: string): string {
  return new Date(`${dayKeyStr}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatEventDateSpanHeading(event: CalendarEventItem): string {
  const startKey = trinidadDayKey(event.starts_at);
  const endKey = trinidadDayKey(event.ends_at);
  if (endKey <= startKey) return formatDayHeading(startKey);
  return `${formatDayHeading(startKey)} – ${formatDayHeading(endKey)}`;
}

function extractMeetingUrl(event: CalendarEventItem): string | null {
  const combined = `${event.location ?? ""} ${event.description ?? ""}`;
  const match = combined.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0].replace(/[.,;:!?]+$/, "") : null;
}

function matchesStaffFilter(
  event: CalendarEventItem,
  staffFilter: string,
  staff: StaffOption[],
): boolean {
  if (!staffFilter) return true;
  const rawHaystack = `${event.title} ${event.description ?? ""} ${event.organiser_name ?? ""}`
    .replace(/https?:\/\/\S+/gi, " ");

  if (staffFilter.startsWith("user:")) {
    const targetId = Number(staffFilter.slice(5));
    if (event.organiser_id === targetId) return true;
    const person = staff.find((s) => s.id === targetId);
    if (!person) return false;
    const nameRe = new RegExp(`\\b${escapeRegExp(person.name)}\\b`, "i");
    return nameRe.test(rawHaystack);
  }

  const entry = STAFF_INITIAL_FILTERS.find((s) => s.code === staffFilter);
  if (!entry) return true;

  if (event.organiser_name && event.organiser_name.toLowerCase() === entry.name.toLowerCase()) {
    return true;
  }

  // Match initials case-sensitively so ordinary words like "Ad hoc" don't match "AD"
  const codePattern = entry.aliases.map(escapeRegExp).join("|");
  const codeRe = new RegExp(`(?<![A-Za-z0-9/])${entry.aliases.length > 1 ? `(?:${codePattern})` : codePattern}(?![A-Za-z0-9/])`);
  if (codeRe.test(rawHaystack)) return true;

  const nameRe = new RegExp(`\\b${escapeRegExp(entry.name)}\\b`, "i");
  return nameRe.test(rawHaystack);
}

function DeleteEventModalBody({
  event,
  onDeleted,
  onCancel,
}: {
  event: CalendarEventItem;
  onDeleted: (deletedId: number) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<CalendarState, FormData>(
    deleteCalendarEventAction,
    {},
  );

  useEffect(() => {
    if (state.ok) {
      onDeleted(event.id);
    }
  }, [state.ok, event.id, onDeleted]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink/75">
        Are you sure you want to permanently delete{" "}
        <span className="font-semibold text-ink">{expandStaffInitials(event.title)}</span> (
        {formatEventDateSpanHeading(event)})? This cannot be undone and stays in the audit trail.
      </p>
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}
      <form action={action} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <input type="hidden" name="id" value={event.id} />
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="btn btn-ghost w-full sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-danger w-full sm:w-auto"
        >
          <Trash2 size={13} /> {pending ? "Deleting…" : "Delete event"}
        </button>
      </form>
    </div>
  );
}

export function CalendarView({
  events,
  canManage,
  initialMonth,
  todayKey,
  staff = [],
  syncMeta,
  projectLinks = {},
}: {
  /** Project milestones (negative ids) mapped to their project, shown read-only. */
  projectLinks?: Record<number, number>;
  events: CalendarEventItem[];
  canManage: boolean;
  initialMonth: string;
  todayKey: string;
  staff?: StaffOption[];
  syncMeta?: CalendarSyncMeta;
}) {
  const router = useRouter();
  const headerCtx = useCalendarHeaderContext();

  const [layoutMode, setLayoutMode] = useState<"month" | "week" | "day" | "agenda">("month");
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMonth); // "2026-11" or "all"
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const y = Number(initialMonth.slice(0, 4));
    return Number.isFinite(y) && y >= 2000 ? y : 2026;
  });
  const [pickerYear, setPickerYear] = useState<number>(selectedYear);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [agendaPage, setAgendaPage] = useState<number>(1);
  const [expandedAgendaIds, setExpandedAgendaIds] = useState<Record<number, boolean>>({});

  const toggleAgendaExpand = useCallback((id: number) => {
    setExpandedAgendaIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => {
    if (initialMonth && todayKey.startsWith(initialMonth)) return todayKey;
    return `${initialMonth}-01`;
  });
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<CalendarEventItem | null>(null);
  const [createForDate, setCreateForDate] = useState<string | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const calendarRef = useRef<FullCalendar | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [autoFocusedQuery, setAutoFocusedQuery] = useState("");
  const [autoFocusDay, setAutoFocusDay] = useState<string | null>(null);
  const pendingAgendaTodayRef = useRef(false);
  const lastKnownSyncedAtRef = useRef<string | null>(syncMeta?.lastSyncedAt ?? null);
  const pageSize = 25;

  useEffect(() => {
    lastKnownSyncedAtRef.current = syncMeta?.lastSyncedAt ?? null;
  }, [syncMeta?.lastSyncedAt]);

  // Keep ExportCalendarButton header context synced with active calendar state
  useEffect(() => {
    headerCtx?.setHeaderState({
      activeMonth: selectedMonth,
      activeYear: selectedYear,
      activeType: typeFilter,
    });
  }, [headerCtx, selectedMonth, selectedYear, typeFilter]);

  // Keep URL ?month=YYYY-MM shallow-synced for refresh/bookmarking
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selectedMonth === "all") {
      url.searchParams.delete("month");
    } else {
      url.searchParams.set("month", selectedMonth);
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [selectedMonth]);

  // Background auto-sync / read-only refresh heartbeat across all calendar.view users
  useEffect(() => {
    if (!syncMeta?.autoSyncEnabled) return;
    const pollMs = Math.max(1, syncMeta.syncIntervalMinutes || 15) * 60 * 1000;
    const timer = setInterval(async () => {
      try {
        if (canManage) {
          const res = await fetch("/api/calendar/sync?auto=1", {
            method: "POST",
            cache: "no-store",
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            ran?: boolean;
            ok?: boolean;
            unchanged?: boolean;
          };
          if (data.ran && data.ok && !data.unchanged) {
            router.refresh();
          }
        } else {
          const res = await fetch("/api/calendar/sync", { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as {
            ok?: boolean;
            lastSyncedAt?: string | null;
          };
          if (
            data.ok &&
            data.lastSyncedAt &&
            data.lastSyncedAt !== lastKnownSyncedAtRef.current
          ) {
            lastKnownSyncedAtRef.current = data.lastSyncedAt;
            router.refresh();
          }
        }
      } catch {
        // Ignore transient network errors during background poll
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [canManage, syncMeta?.autoSyncEnabled, syncMeta?.syncIntervalMinutes, router]);

  // Merge hardcoded staff filters with any active staff users not already listed
  const staffDropdownOptions = useMemo(() => {
    const knownNames = new Set(STAFF_INITIAL_FILTERS.map((s) => s.name.toLowerCase()));
    const base = STAFF_INITIAL_FILTERS.map((s) => ({ value: s.code, label: s.name }));
    const extras = staff
      .filter((person) => !person.inactive && !knownNames.has(person.name.toLowerCase()))
      .map((person) => ({ value: `user:${person.id}`, label: person.name }));
    return [...base, ...extras];
  }, [staff]);

  // Filter events by search, type, and staff (matching both raw initials and expanded names)
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((event) => {
      if (typeFilter !== "ALL" && event.event_type !== typeFilter) return false;
      if (staffFilter && !matchesStaffFilter(event, staffFilter, staff)) return false;
      if (q) {
        const titleExp = expandStaffInitials(event.title);
        const descExp = event.description ? expandStaffInitials(event.description) : "";
        const hay = `${event.title} ${titleExp} ${event.location ?? ""} ${
          event.description ?? ""
        } ${descExp} ${event.organiser_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, typeFilter, staffFilter, search, staff]);

  // Auto-zone the calendar only when the search query itself changes (never hijacking
  // category/staff clicks). Done during render, once per new query; only the call
  // that moves FullCalendar's own view waits for the effect below.
  const autoQuery = search.trim().toLowerCase();
  if (autoQuery !== autoFocusedQuery) {
    if (!autoQuery) {
      setAutoFocusedQuery("");
    } else if (filteredEvents.length > 0) {
      setAutoFocusedQuery(autoQuery);
      const sorted = filteredEvents.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const currentMonthMatch =
        selectedMonth !== "all"
          ? sorted.find((ev) => {
              const { start, end } = monthBounds(selectedMonth);
              return eventOverlapsRange(ev, start, end);
            })
          : undefined;
      const match = currentMonthMatch ?? sorted[0];
      const matchDayKey = trinidadDayKey(match.starts_at);
      setSelectedYear(Number(matchDayKey.slice(0, 4)));
      if (selectedMonth !== "all" || layoutMode !== "agenda") {
        setSelectedMonth(matchDayKey.slice(0, 7));
      }
      setSelectedDateKey(matchDayKey);
      setSelectedEventId(filteredEvents.length === 1 ? match.id : null);
      setAutoFocusDay(matchDayKey);
    }
  }

  useEffect(() => {
    if (autoFocusDay) calendarRef.current?.getApi()?.gotoDate(autoFocusDay);
  }, [autoFocusDay]);

  // Event counts by type (respecting active month/year, search, and staff filters + multi-day overlap)
  const countsByType = useMemo(() => {
    const bounds =
      selectedMonth === "all"
        ? { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` }
        : monthBounds(selectedMonth);

    const base = events.filter((event) => {
      if (!eventOverlapsRange(event, bounds.start, bounds.end)) return false;
      if (staffFilter && !matchesStaffFilter(event, staffFilter, staff)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const titleExp = expandStaffInitials(event.title);
        const descExp = event.description ? expandStaffInitials(event.description) : "";
        const hay = `${event.title} ${titleExp} ${event.location ?? ""} ${
          event.description ?? ""
        } ${descExp} ${event.organiser_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const map: Record<string, number> = {
      ALL: base.length,
      MEETING: 0,
      MISSION: 0,
      LEAVE: 0,
      HOLIDAY: 0,
      DEADLINE: 0,
      OTHER: 0,
    };
    for (const ev of base) {
      map[ev.event_type] = (map[ev.event_type] ?? 0) + 1;
    }
    return map;
  }, [events, selectedMonth, selectedYear, staffFilter, search, staff]);

  // Event counts per month for the pickerYear ribbon (counting overlapping multi-day spans)
  const countsByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      const key = `${pickerYear}-${String(m).padStart(2, "0")}`;
      const { start, end } = monthBounds(key);
      let count = 0;
      for (const ev of filteredEvents) {
        if (eventOverlapsRange(ev, start, end)) count += 1;
      }
      map[key] = count;
    }
    return map;
  }, [filteredEvents, pickerYear]);

  const pickerYearCount = useMemo(() => {
    const yStart = `${pickerYear}-01-01`;
    const yEnd = `${pickerYear}-12-31`;
    return filteredEvents.filter((ev) => eventOverlapsRange(ev, yStart, yEnd)).length;
  }, [filteredEvents, pickerYear]);

  // Sync FullCalendar view when layoutMode changes while mounted
  useEffect(() => {
    if (layoutMode === "agenda") return;
    const fcView =
      layoutMode === "month" ? "dayGridMonth" : layoutMode === "week" ? "timeGridWeek" : "timeGridDay";
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (api.view.type !== fcView) {
      api.changeView(fcView, selectedDateKey);
      if (layoutMode !== "month") {
        api.scrollToTime("07:30:00");
      }
    }
  }, [layoutMode, selectedDateKey]);

  const jumpToMonth = useCallback(
    (monthKey: string) => {
      const y = Number(monthKey.slice(0, 4));
      if (Number.isFinite(y) && y >= 2000) setSelectedYear(y);
      setSelectedMonth(monthKey);
      setAgendaPage(1);
      setSelectedEventId(null);
      if (monthKey !== "all") {
        const targetDate = monthKey === todayKey.slice(0, 7) ? todayKey : `${monthKey}-01`;
        setSelectedDateKey(targetDate);
        const api = calendarRef.current?.getApi();
        if (api) {
          api.gotoDate(targetDate);
        }
      }
    },
    [todayKey],
  );

  const switchCalendarView = useCallback(
    (mode: "month" | "week" | "day" | "agenda") => {
      if (mode !== "agenda" && selectedMonth === "all") {
        const currentYearNum = Number(todayKey.slice(0, 4));
        const fallbackMonth =
          selectedYear === currentYearNum ? todayKey.slice(0, 7) : `${selectedYear}-01`;
        const fallbackDate =
          fallbackMonth === todayKey.slice(0, 7) ? todayKey : `${fallbackMonth}-01`;
        setSelectedMonth(fallbackMonth);
        setSelectedDateKey(fallbackDate);
      }
      setLayoutMode(mode);
    },
    [selectedMonth, selectedYear, todayKey],
  );

  // Events for the active month or selectedYear (respecting multi-day overlaps)
  const monthFilteredEvents = useMemo(() => {
    const bounds =
      selectedMonth === "all"
        ? { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` }
        : monthBounds(selectedMonth);
    return filteredEvents
      .filter((ev) => eventOverlapsRange(ev, bounds.start, bounds.end))
      .slice()
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [filteredEvents, selectedMonth, selectedYear]);

  // Selected event object (always respects active filters)
  const selectedEvent = useMemo(
    () => (selectedEventId ? filteredEvents.find((e) => e.id === selectedEventId) ?? null : null),
    [filteredEvents, selectedEventId],
  );

  // Events on the selected day (for the sidebar inspector)
  const selectedDayEvents = useMemo(() => {
    return filteredEvents
      .filter((ev) => eventOverlapsRange(ev, selectedDateKey, selectedDateKey))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [filteredEvents, selectedDateKey]);

  // Agenda pagination (clamped so deleting the last item on page N never strands on an empty page)
  const totalPages = Math.max(1, Math.ceil(monthFilteredEvents.length / pageSize));
  const safeAgendaPage = Math.min(agendaPage, totalPages);

  const agendaVisible = monthFilteredEvents.slice(
    (safeAgendaPage - 1) * pageSize,
    safeAgendaPage * pageSize,
  );

  const agendaGrouped = useMemo(() => {
    const activeStart =
      selectedMonth === "all" ? `${selectedYear}-01-01` : `${selectedMonth}-01`;
    const grouped = agendaVisible.reduce<Record<string, CalendarEventItem[]>>((acc, ev) => {
      const evStart = trinidadDayKey(ev.starts_at);
      const displayDayKey = evStart < activeStart ? activeStart : evStart;
      (acc[displayDayKey] ??= []).push(ev);
      return acc;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [agendaVisible, selectedMonth, selectedYear]);

  const stepCalendar = useCallback(
    (dir: "prev" | "next" | "today") => {
      if (layoutMode === "agenda") {
        if (dir === "today") {
          const ym = todayKey.slice(0, 7);
          const { start, end } = monthBounds(ym);
          pendingAgendaTodayRef.current = true;
          setSelectedYear(Number(todayKey.slice(0, 4)));
          setSelectedMonth(ym);
          setSelectedDateKey(todayKey);
          setSelectedEventId(null);

          const monthList = filteredEvents
            .filter((ev) => eventOverlapsRange(ev, start, end))
            .slice()
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          let idx = monthList.findIndex((ev) => trinidadDayKey(ev.ends_at) >= todayKey);
          if (idx < 0 && monthList.length > 0) idx = monthList.length - 1;
          const targetPage = idx >= 0 ? Math.floor(idx / pageSize) + 1 : 1;
          const evStart = idx >= 0 ? trinidadDayKey(monthList[idx].starts_at) : todayKey;
          const targetDayKey = evStart < start ? start : evStart;

          setAgendaPage(targetPage);
          setTimeout(() => {
            pendingAgendaTodayRef.current = false;
            document.getElementById(`agenda-day-${targetDayKey}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 60);
          return;
        }
        if (selectedMonth === "all") {
          const nextY = selectedYear + (dir === "next" ? 1 : -1);
          setSelectedYear(nextY);
          setAgendaPage(1);
          setSelectedEventId(null);
          setSelectedDateKey(nextY === Number(todayKey.slice(0, 4)) ? todayKey : `${nextY}-01-01`);
          return;
        }
        const [y, m] = selectedMonth.split("-").map(Number);
        const nextDate = new Date(Date.UTC(y, m - 1 + (dir === "next" ? 1 : -1), 1));
        const nextY = nextDate.getUTCFullYear();
        const nextM = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
        setSelectedYear(nextY);
        jumpToMonth(`${nextY}-${nextM}`);
        return;
      }

      const api = calendarRef.current?.getApi();
      if (!api) return;
      if (dir === "prev") api.prev();
      else if (dir === "next") api.next();
      else api.today();

      const current = api.getDate();
      const dayKey = current.toISOString().slice(0, 10);
      const ym = dayKey.slice(0, 7);
      const y = Number(ym.slice(0, 4));
      setSelectedYear(y);
      setSelectedMonth(ym);
      setSelectedEventId(null);
      if (dir === "today") {
        setSelectedDateKey(todayKey);
      } else if (layoutMode === "month") {
        setSelectedDateKey(ym === todayKey.slice(0, 7) ? todayKey : `${ym}-01`);
      } else {
        setSelectedDateKey(dayKey);
      }
    },
    [layoutMode, selectedMonth, selectedYear, todayKey, jumpToMonth, filteredEvents, pageSize],
  );

  // Custom event pill inside FullCalendar
  const renderEventContent = useCallback((arg: EventContentArg) => {
    const ext = arg.event.extendedProps as {
      rawEvent: CalendarEventItem;
      tone: (typeof TYPES)[string];
    };
    const ev = ext.rawEvent;
    const tone = ext.tone;
    const isAllDay = arg.event.allDay;
    const isTimeGrid = arg.view.type.startsWith("timeGrid");
    const timeLabel = !isAllDay
      ? new Date(ev.starts_at)
          .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/Port_of_Spain",
          })
          .replace(" AM", "a")
          .replace(" PM", "p")
          .replace(":00", "")
      : null;

    if (isTimeGrid) {
      return (
        <div
          className="flex h-full w-full flex-col justify-start overflow-hidden px-1 py-0.5 text-left"
          title={`${expandStaffInitials(ev.title)}${ev.location ? ` · ${ev.location}` : ""}`}
        >
          {timeLabel && (
            <span
              className="truncate text-[10px] font-semibold leading-tight opacity-80 tabular-nums"
              style={{ color: tone.text }}
            >
              {timeLabel}
            </span>
          )}
          <span
            className="line-clamp-2 break-words text-[11px] font-medium leading-tight"
            style={{ color: tone.text }}
          >
            {expandStaffInitials(arg.event.title)}
          </span>
        </div>
      );
    }

    return (
      <div
        className="flex w-full items-center gap-1.5 overflow-hidden px-1.5 py-0.5 text-left"
        title={`${expandStaffInitials(ev.title)}${ev.location ? ` · ${ev.location}` : ""}`}
      >
        {timeLabel && (
          <span
            className="shrink-0 text-[10px] font-semibold tracking-tight opacity-75 tabular-nums"
            style={{ color: tone.text }}
          >
            {timeLabel}
          </span>
        )}
        <span
          className="truncate text-[11px] font-medium leading-tight"
          style={{ color: tone.text }}
        >
          {expandStaffInitials(arg.event.title)}
        </span>
      </div>
    );
  }, []);

  const activeMonthTitle = useMemo(() => {
    if (selectedMonth === "all") return `All of ${selectedYear}`;
    const [y, m] = selectedMonth.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [selectedMonth, selectedYear]);

  // Reset agenda page when filters change (unless explicitly jumping to Today in agenda)
  useEffect(() => {
    if (pendingAgendaTodayRef.current) return;
    setAgendaPage(1);
  }, [typeFilter, staffFilter, search, selectedMonth, selectedYear]);

  // Close the month/year picker popover on outside click or Escape
  useEffect(() => {
    if (!monthPickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setMonthPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMonthPickerOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [monthPickerOpen]);

  const stepUnitLabel =
    layoutMode === "agenda" && selectedMonth === "all"
      ? "year"
      : layoutMode === "week"
        ? "week"
        : layoutMode === "day"
          ? "day"
          : "month";

  const calendarCardHeader = (
    <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-3.5 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => stepCalendar("prev")}
            className="rounded-xl border border-ink/12 bg-white p-1.5 text-ink/70 transition hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
            title={`Previous ${stepUnitLabel}`}
            aria-label={`Previous ${stepUnitLabel}`}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => stepCalendar("today")}
            className="rounded-xl border border-ink/12 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink/75 transition hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => stepCalendar("next")}
            className="rounded-xl border border-ink/12 bg-white p-1.5 text-ink/70 transition hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
            title={`Next ${stepUnitLabel}`}
            aria-label={`Next ${stepUnitLabel}`}
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Clickable Month & Year Picker */}
        <div ref={pickerRef} className="relative flex items-center gap-2">
          <button
            type="button"
            aria-expanded={monthPickerOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setPickerYear(selectedYear);
              setMonthPickerOpen((open) => !open);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition ${
              monthPickerOpen
                ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                : "border-ink/12 bg-white text-ink hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
            }`}
          >
            <span>{activeMonthTitle}</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-150 ${monthPickerOpen ? "rotate-180" : ""}`}
            />
          </button>

          {monthPickerOpen && (
            <div
              role="dialog"
              aria-label="Choose month or full year"
              className="animate-popover absolute top-full left-0 z-30 mt-2 w-72 rounded-2xl border border-ink/12 bg-white p-3 shadow-xl"
            >
              <div className="mb-2.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => Math.max(2000, y - 1))}
                    className="rounded-lg border border-ink/12 p-1 text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                    aria-label="Previous year"
                    title="Previous year"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="min-w-[3.2rem] text-center text-xs font-semibold text-ink tabular-nums">
                    {pickerYear}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerYear((y) => Math.min(2100, y + 1))}
                    className="rounded-lg border border-ink/12 p-1 text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                    aria-label="Next year"
                    title="Next year"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
                <span className="text-[11px] text-ink/60 tabular-nums">
                  {pickerYearCount} event{pickerYearCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_NAMES.map((label, idx) => {
                  const mKey = `${pickerYear}-${String(idx + 1).padStart(2, "0")}`;
                  const count = countsByMonth[mKey] ?? 0;
                  const isSelected = selectedMonth === mKey;
                  return (
                    <button
                      key={mKey}
                      type="button"
                      onClick={() => {
                        jumpToMonth(mKey);
                        if (layoutMode === "agenda") {
                          setLayoutMode("month");
                        }
                        setMonthPickerOpen(false);
                      }}
                      className={`flex items-center justify-between rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
                        isSelected
                          ? "border-iica-700 bg-iica-700 font-semibold text-white shadow-xs"
                          : count > 0
                            ? "border-ink/10 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                            : "border-ink/8 bg-white text-ink/45 hover:border-ink/15 hover:bg-iica-50/50 hover:text-ink/70"
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`text-[10px] tabular-nums ${
                          isSelected ? "text-white/80" : "text-ink/55"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 border-t border-ink/8 pt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYear(pickerYear);
                    setSelectedMonth("all");
                    setAgendaPage(1);
                    setSelectedEventId(null);
                    setLayoutMode("agenda");
                    setMonthPickerOpen(false);
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    selectedMonth === "all" && selectedYear === pickerYear
                      ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                      : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                  }`}
                >
                  All {pickerYear} ({pickerYearCount} event{pickerYearCount === 1 ? "" : "s"})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        role="group"
        aria-label="Calendar display mode"
        className="flex flex-wrap items-center gap-1"
      >
        {(
          [
            { id: "month", label: "Month", icon: <CalendarIcon size={13} /> },
            { id: "week", label: "Week", icon: <CalendarDays size={13} /> },
            { id: "day", label: "Day", icon: <Clock size={13} /> },
            { id: "agenda", label: "Agenda", icon: <LayoutList size={13} /> },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={layoutMode === tab.id}
            onClick={() => switchCalendarView(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              layoutMode === tab.id
                ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const fcInitialView =
    layoutMode === "week" ? "timeGridWeek" : layoutMode === "day" ? "timeGridDay" : "dayGridMonth";

  const fullCalendarEvents = useMemo(
    () =>
      filteredEvents.map((event) => {
        const tone = toneFor(event.event_type);
        const startDay = trinidadDayKey(event.starts_at);
        const endDay = trinidadDayKey(event.ends_at);
        const effectiveEndDay = endDay >= startDay ? endDay : startDay;
        return {
          id: String(event.id),
          title: expandStaffInitials(event.title),
          start: event.all_day ? startDay : toTrinidadWallIso(event.starts_at),
          end: event.all_day
            ? addDaysToDayKey(effectiveEndDay, 1)
            : toTrinidadWallIso(event.ends_at),
          allDay: event.all_day,
          backgroundColor: tone.tint,
          borderColor: tone.border,
          textColor: tone.text,
          extendedProps: {
            rawEvent: event,
            tone,
          },
        };
      }),
    [filteredEvents],
  );

  const selectedEventMeetingUrl = selectedEvent ? extractMeetingUrl(selectedEvent) : null;

  return (
    <div className="space-y-4">
      {/* 1. Category Pills & Inline Filters */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          className="w-full sm:w-auto sm:min-w-[11rem]"
          ariaLabel="Filter by event category"
          options={[
            { value: "ALL", label: "All events", count: countsByType.ALL ?? 0 },
            { value: "MEETING", label: "Meetings", count: countsByType.MEETING ?? 0 },
            { value: "MISSION", label: "Missions", count: countsByType.MISSION ?? 0 },
            { value: "LEAVE", label: "Leave", count: countsByType.LEAVE ?? 0 },
            { value: "HOLIDAY", label: "Holidays", count: countsByType.HOLIDAY ?? 0 },
            { value: "DEADLINE", label: "Deadlines", count: countsByType.DEADLINE ?? 0 },
            { value: "OTHER", label: "General", count: countsByType.OTHER ?? 0 },
            ...(countsByType.PROJECT
              ? [{ value: "PROJECT", label: "Projects", count: countsByType.PROJECT }]
              : []),
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:w-60 sm:flex-none">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/45"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events or staff…"
              aria-label="Search events or staff"
              className="field py-1.5 pr-7 pl-8 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/50 hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Users size={14} className="hidden text-ink/45 sm:block" />
            <FilterSelect
              value={staffFilter}
              onChange={setStaffFilter}
              className="min-w-[11rem]"
              ariaLabel="Filter by team member"
              options={[{ value: "", label: "All team members" }, ...staffDropdownOptions.map((s) => ({ value: s.value, label: s.label }))]}
            />
          </div>

          {(typeFilter !== "ALL" || staffFilter || search) && (
            <button
              type="button"
              onClick={() => {
                setTypeFilter("ALL");
                setStaffFilter("");
                setSearch("");
              }}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* 2. Unified Calendar Workspace */}
      {layoutMode === "agenda" ? (
        <div className="panel relative">
          {calendarCardHeader}
          {monthFilteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-ink/10 bg-iica-50 text-iica-700">
                <CalendarDays size={20} />
              </div>
              <div className="text-sm font-semibold text-ink">
                No events found for {activeMonthTitle}
              </div>
              <p className="mt-1 max-w-md text-xs text-ink/60">
                Choose another month above
                {selectedMonth !== "all" && (
                  <>
                    , switch to{" "}
                    <button
                      type="button"
                      onClick={() => setSelectedMonth("all")}
                      className="font-semibold text-iica-700 underline"
                    >
                      All {selectedYear}
                    </button>
                  </>
                )}
                , or clear your filters.
              </p>
            </div>
          ) : (
            <>
              <div
                key={`agenda-${selectedMonth}-${selectedYear}-${typeFilter}-${staffFilter}-${safeAgendaPage}`}
                className="animate-fade divide-y divide-ink/8"
              >
                {agendaGrouped.map(([dayKeyStr, dayEvents]) => {
                  const isToday = dayKeyStr === todayKey;
                  return (
                    <div
                      key={dayKeyStr}
                      id={`agenda-day-${dayKeyStr}`}
                      className={`px-4 py-4 sm:px-6 ${isToday ? "bg-iica-50/35" : ""}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                              isToday
                                ? "bg-iica-700 text-white"
                                : "bg-iica-50 text-iica-800"
                            }`}
                          >
                            {dayKeyStr.slice(8, 10)}
                          </span>
                          <h3 className="text-sm font-semibold text-ink">
                            {formatDayHeading(dayKeyStr)}
                          </h3>
                          {isToday && (
                            <span className="rounded-full bg-iica-100 px-2 py-0.5 text-[10px] font-semibold text-iica-800">
                              Today
                            </span>
                          )}
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setCreateForDate(dayKeyStr)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink/60 transition hover:bg-iica-50 hover:text-iica-700"
                          >
                            <Plus size={13} /> Schedule
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5 pl-1 sm:pl-9">
                        {dayEvents.map((event) => {
                          const tone = toneFor(event.event_type);
                          const meetingUrl = extractMeetingUrl(event);
                          const displayTitle = expandStaffInitials(event.title);
                          const displayDesc = event.description
                            ? expandStaffInitials(event.description)
                            : null;
                          const isExpanded = Boolean(expandedAgendaIds[event.id]);

                          return (
                            <div
                              key={event.id}
                              className="overflow-hidden rounded-xl border border-ink/10 bg-white transition hover:border-iica-300"
                            >
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => toggleAgendaExpand(event.id)}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                              >
                                <span className="w-28 shrink-0 text-xs font-medium text-ink/60 tabular-nums sm:w-40">
                                  {formatTrinidadTimeRange(event)}
                                </span>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badgeBg}`}
                                >
                                  {tone.label}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                                  {displayTitle}
                                </span>
                                {event.organiser_name && (
                                  <span className="hidden shrink-0 items-center gap-1 rounded-md bg-iica-50 px-2 py-0.5 text-xs font-medium text-iica-800 md:inline-flex">
                                    <User size={11} />
                                    {event.organiser_name}
                                  </span>
                                )}
                                <ChevronDown
                                  size={15}
                                  className={`shrink-0 text-ink/45 transition-transform duration-150 ${
                                    isExpanded ? "rotate-180" : ""
                                  }`}
                                />
                              </button>

                              {isExpanded && (
                                <div className="animate-expand space-y-2.5 border-t border-ink/8 bg-iica-50/30 px-3.5 py-3">
                                  <div className="text-sm font-semibold leading-snug text-ink">
                                    {displayTitle}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink/70">
                                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-medium text-ink/75 ring-1 ring-ink/10">
                                      <CalendarCheck2 size={11} className="text-iica-700" />
                                      {formatEventDateSpanHeading(event)} · {formatTrinidadTimeRange(event)}
                                    </span>
                                    {event.organiser_name && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-medium text-iica-800 ring-1 ring-ink/10">
                                        <User size={11} />
                                        {event.organiser_name}
                                      </span>
                                    )}
                                    {event.location && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-ink/75 ring-1 ring-ink/10">
                                        <MapPin size={11} className="text-iica-700" />
                                        {event.location}
                                      </span>
                                    )}
                                  </div>

                                  {displayDesc && (
                                    <div className="whitespace-pre-line text-xs leading-relaxed text-ink/75">
                                      {displayDesc}
                                    </div>
                                  )}

                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    {meetingUrl && (
                                      <a
                                        href={meetingUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-ghost px-2.5 py-1 text-xs text-iica-700"
                                      >
                                        <Video size={13} /> Join
                                      </a>
                                    )}
                                    {projectLinks[event.id] && (
                                      <Link
                                        href={`/projects/${projectLinks[event.id]}`}
                                        className="btn btn-ghost px-2.5 py-1 text-xs text-iica-700"
                                      >
                                        Open project
                                      </Link>
                                    )}
                                    {canManage && event.id > 0 && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => setEditingEvent(event)}
                                          className="btn btn-ghost px-2.5 py-1 text-xs"
                                        >
                                          <Pencil size={12} /> Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeletingEvent(event)}
                                          className="btn btn-danger px-2.5 py-1 text-xs"
                                        >
                                          <Trash2 size={12} /> Delete
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-ink/8 bg-iica-50/40 px-5 py-3 text-xs text-ink/60">
                <span>
                  Showing {(safeAgendaPage - 1) * pageSize + 1}–
                  {Math.min(safeAgendaPage * pageSize, monthFilteredEvents.length)} of{" "}
                  {monthFilteredEvents.length} events
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost px-3 py-1.5 text-xs"
                    disabled={safeAgendaPage <= 1}
                    onClick={() => setAgendaPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="font-medium tabular-nums">
                    Page {safeAgendaPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost px-3 py-1.5 text-xs"
                    disabled={safeAgendaPage >= totalPages}
                    onClick={() => setAgendaPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* Left: Unified Calendar Surface (Header + Grid) */}
          <div className="panel relative">
            {calendarCardHeader}

            <div className="full-calendar-shell px-3 pt-3 pb-3 sm:px-4 [&_.fc-scrollgrid]:min-w-[640px] sm:[&_.fc-scrollgrid]:min-w-0">
              <DynamicFullCalendar
                fcRef={calendarRef}
                initialViewType={fcInitialView}
                initialDate={selectedDateKey}
                timeZone="UTC"
                now={() => new Date(Date.now() - AST_OFFSET_MS)}
                headerToolbar={false}
                height={660}
                expandRows
                nowIndicator
                firstDay={1}
                fixedWeekCount={false}
                dayMaxEvents={3}
                eventDisplay="block"
                eventContent={renderEventContent}
                datesSet={(arg) => {
                  const focus = arg.view.calendar.getDate();
                  const ym = focus.toISOString().slice(0, 7);
                  const y = Number(ym.slice(0, 4));
                  setSelectedYear(y);
                  setSelectedMonth(ym);
                }}
                dateClick={(arg) => {
                  setSelectedDateKey(arg.dateStr.slice(0, 10));
                  setSelectedEventId(null);
                }}
                eventClick={(arg) => {
                  arg.jsEvent.preventDefault();
                  const id = Number(arg.event.id);
                  setSelectedEventId(id);
                  const found = events.find((e) => e.id === id);
                  if (found) {
                    const startKey = trinidadDayKey(found.starts_at);
                    const endKey = trinidadDayKey(found.ends_at);
                    if (selectedDateKey < startKey || selectedDateKey > endKey) {
                      setSelectedDateKey(startKey);
                    }
                  }
                }}
                events={fullCalendarEvents}
              />

              {/* Legend Footer (non-clickable reference pills + unhighlighted total count) */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-3 text-xs text-ink/60">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(TYPES).map(([key, meta]) => (
                    <span
                      key={key}
                      style={{
                        backgroundColor: meta.tint,
                        borderColor: meta.border,
                        color: meta.text,
                      }}
                      className="inline-flex cursor-default items-center rounded-lg border px-2.5 py-0.5 text-[11px] font-medium select-none"
                    >
                      {meta.label}
                    </span>
                  ))}
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
                  <span>
                    {selectedMonth === "all"
                      ? `Total events in ${selectedYear}:`
                      : "Total events this month:"}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">
                    {monthFilteredEvents.length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live Day & Event Inspector Sidebar */}
          <aside className="panel flex flex-col justify-between overflow-hidden">
            {selectedEvent ? (
              <div
                key={`event-${selectedEvent.id}`}
                className="animate-fade flex h-full flex-col justify-between p-5"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2 border-b border-ink/8 pb-3.5">
                    <div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          toneFor(selectedEvent.event_type).badgeBg
                        }`}
                      >
                        {toneFor(selectedEvent.event_type).label}
                      </span>
                      <h3 className="mt-2 text-base font-semibold leading-snug text-ink">
                        {expandStaffInitials(selectedEvent.title)}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(null)}
                      className="rounded-lg p-1.5 text-ink/45 transition hover:bg-ink/5 hover:text-ink"
                      title="Back to day schedule"
                      aria-label="Back to day schedule"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-2.5 rounded-xl border border-ink/8 bg-iica-50/45 p-3.5 text-xs">
                    <div className="flex items-start gap-2.5">
                      <CalendarCheck2 size={15} className="mt-0.5 shrink-0 text-iica-700" />
                      <div>
                        <div className="font-semibold text-ink">
                          {formatEventDateSpanHeading(selectedEvent)}
                        </div>
                        <div className="mt-0.5 text-ink/65">
                          {formatTrinidadTimeRange(selectedEvent)} (AST)
                        </div>
                      </div>
                    </div>

                    {(selectedEvent.location || selectedEventMeetingUrl) && (
                      <div className="flex items-start gap-2.5 border-t border-ink/6 pt-2.5">
                        {selectedEvent.location ? (
                          <MapPin size={15} className="mt-0.5 shrink-0 text-iica-700" />
                        ) : (
                          <Video size={15} className="mt-0.5 shrink-0 text-iica-700" />
                        )}
                        <div className="min-w-0 flex-1">
                          {selectedEvent.location && (
                            <div className="font-medium text-ink">{selectedEvent.location}</div>
                          )}
                          {selectedEventMeetingUrl && (
                            <a
                              href={selectedEventMeetingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${selectedEvent.location ? "mt-1 " : ""}inline-flex items-center gap-1 font-semibold text-iica-700 hover:underline`}
                            >
                              <ExternalLink size={12} /> Open virtual meeting link
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedEvent.organiser_name && (
                      <div className="flex items-center gap-2.5 border-t border-ink/6 pt-2.5">
                        <User size={15} className="shrink-0 text-iica-700" />
                        <div>
                          <span className="text-ink/60">Lead / Organiser: </span>
                          <span className="font-semibold text-ink">
                            {selectedEvent.organiser_name}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedEvent.description && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-ink/65">
                        Details &amp; participants
                      </div>
                      <div className="whitespace-pre-line rounded-xl border border-ink/8 bg-white p-3 text-xs leading-relaxed text-ink/75">
                        {expandStaffInitials(selectedEvent.description)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-2 border-t border-ink/8 pt-4">
                  {projectLinks[selectedEvent.id] && (
                    <Link
                      href={`/projects/${projectLinks[selectedEvent.id]}`}
                      className="btn btn-primary w-full py-2 text-xs"
                    >
                      Open project
                    </Link>
                  )}
                  {canManage && selectedEvent.id > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingEvent(selectedEvent)}
                        className="btn btn-ghost flex-1 py-2 text-xs"
                      >
                        <Pencil size={13} /> Edit event
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingEvent(selectedEvent)}
                        className="btn btn-danger py-2 text-xs"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedEventId(null)}
                    className="w-full rounded-lg py-1.5 text-center text-xs font-medium text-ink/60 hover:bg-ink/5 hover:text-ink"
                  >
                    ← Back to {formatDayHeading(selectedDateKey)}
                  </button>
                </div>
              </div>
            ) : (
              <div key={`day-${selectedDateKey}`} className="animate-fade flex h-full flex-col">
                <header className="border-b border-ink/8 px-5 py-4">
                  <div className="text-xs font-semibold text-iica-700">Selected day</div>
                  <h3 className="mt-0.5 text-sm font-semibold text-ink">
                    {formatDayHeading(selectedDateKey)}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink/60">
                    {selectedDayEvents.length === 0
                      ? "Nothing scheduled on this day"
                      : `${selectedDayEvents.length} event${
                          selectedDayEvents.length === 1 ? "" : "s"
                        } scheduled`}
                  </p>
                </header>

                <div className="flex-1 overflow-y-auto">
                  {selectedDayEvents.length > 0 ? (
                    <div className="space-y-2 p-4">
                      {selectedDayEvents.map((ev) => {
                        const tone = toneFor(ev.event_type);
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => setSelectedEventId(ev.id)}
                            style={{
                              backgroundColor: tone.tint,
                              borderColor: tone.border,
                            }}
                            className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:brightness-[0.97]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="text-[11px] font-semibold tabular-nums opacity-85"
                                  style={{ color: tone.text }}
                                >
                                  {formatTrinidadTimeRange(ev)}
                                </span>
                                <span
                                  className={`rounded-full border px-1.5 py-0.2 text-[9px] font-semibold ${tone.badgeBg}`}
                                >
                                  {tone.label}
                                </span>
                              </div>
                              <div
                                className="mt-1 text-xs font-semibold leading-snug"
                                style={{ color: tone.text }}
                              >
                                {expandStaffInitials(ev.title)}
                              </div>
                              {(ev.location || ev.organiser_name) && (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink/65">
                                  {ev.location && (
                                    <span className="inline-flex items-center gap-1">
                                      <MapPin size={10} /> {ev.location}
                                    </span>
                                  )}
                                  {ev.organiser_name && (
                                    <span className="inline-flex items-center gap-1">
                                      <User size={10} /> {ev.organiser_name}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setCreateForDate(selectedDateKey)}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-ink/15 py-2.5 text-xs font-semibold text-iica-700 transition hover:border-iica-300 hover:bg-iica-50/50"
                        >
                          <Plus size={13} /> Schedule an event on this date
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="px-5 py-6">
                      <div className="rounded-xl border border-dashed border-ink/12 bg-iica-50/30 p-4 text-center">
                        <p className="text-xs font-medium text-ink/65">
                          No events on {formatDayHeading(selectedDateKey)}
                        </p>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setCreateForDate(selectedDateKey)}
                            className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-iica-700 hover:underline"
                          >
                            <Plus size={13} /> Schedule an event on this date
                          </button>
                        )}
                      </div>

                      {monthFilteredEvents.length > 0 && (
                        <div className="mt-5">
                          <div className="mb-2.5 text-xs font-semibold text-ink/60">
                            In {activeMonthTitle} ({monthFilteredEvents.length})
                          </div>
                          <div className="space-y-2">
                            {monthFilteredEvents.slice(0, 7).map((ev) => {
                              const tone = toneFor(ev.event_type);
                              const dKey = trinidadDayKey(ev.starts_at);
                              return (
                                <button
                                  key={ev.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedDateKey(dKey);
                                    setSelectedEventId(ev.id);
                                  }}
                                  className="flex w-full items-start gap-2.5 rounded-xl border border-ink/8 p-2.5 text-left transition hover:border-iica-300 hover:bg-iica-50/50"
                                >
                                  <span
                                    style={{
                                      backgroundColor: tone.tint,
                                      borderColor: tone.border,
                                      color: tone.text,
                                    }}
                                    className="flex h-7 w-7 shrink-0 flex-col items-center justify-center rounded-lg border text-[10px] font-bold tabular-nums"
                                  >
                                    {dKey.slice(8, 10)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-semibold text-ink">
                                      {expandStaffInitials(ev.title)}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink/60">
                                      <span>{formatTrinidadTimeRange(ev)}</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Edit Event Modal */}
      <Modal
        open={Boolean(editingEvent)}
        onClose={() => setEditingEvent(null)}
        title="Edit event"
        description="Update event details."
      >
        {editingEvent && (
          <EventFormFields
            key={`edit-${editingEvent.id}`}
            event={editingEvent}
            staff={staff}
            onSaved={() => setEditingEvent(null)}
            onCancel={() => setEditingEvent(null)}
          />
        )}
      </Modal>

      {/* Quick Create Event on Selected Date Modal */}
      <Modal
        open={Boolean(createForDate)}
        onClose={() => setCreateForDate(null)}
        title={createForDate ? `Schedule event · ${formatDayHeading(createForDate)}` : "Schedule event"}
        description="Add an event for this date."
      >
        {createForDate && (
          <EventFormFields
            key={`create-${createForDate}`}
            defaultDate={createForDate}
            staff={staff}
            onSaved={() => setCreateForDate(null)}
            onCancel={() => setCreateForDate(null)}
          />
        )}
      </Modal>

      {/* Delete Event Confirmation Modal */}
      <Modal
        open={Boolean(deletingEvent)}
        onClose={() => setDeletingEvent(null)}
        title="Delete event?"
        width="max-w-md"
      >
        {deletingEvent && (
          <DeleteEventModalBody
            key={`delete-${deletingEvent.id}`}
            event={deletingEvent}
            onDeleted={(deletedId) => {
              setDeletingEvent(null);
              if (selectedEventId === deletedId) {
                setSelectedEventId(null);
              }
            }}
            onCancel={() => setDeletingEvent(null)}
          />
        )}
      </Modal>
    </div>
  );
}
