"use client";

import { FilterSelect } from "@/components/filter-select";

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  CloudDownload,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderSync,
  Info,
  Plus,
  RefreshCw,
  Upload,
  Webhook,
} from "lucide-react";
import { Modal } from "@/components/modal";
import {
  createCalendarEventAction,
  importCalendarAction,
  syncSharePointCalendarAction,
  syncTimelinesToCalendarAction,
  updateCalendarEventAction,
  type CalendarState,
} from "./actions";

export type EditableCalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  organiser_id: number | null;
  organiser_name: string | null;
};

export type StaffOption = {
  id: number;
  name: string;
  inactive?: boolean;
};

export type SyncConfigClientProps = {
  sharepointUrl: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  pruneDeleted: boolean;
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  lastStatus: string;
  lastMessage: string | null;
  webhookSecret?: string;
};

const SHAREPOINT_DEFAULT_URL =
  "https://iicaint-my.sharepoint.com/:x:/r/personal/geselle_hodge_iica_int/Documents/2026%20Team-TT%20Calendar.xlsx?d=w279e69ea960e4d5db4d24ec75dce6ba0&e=4%3A3419b183d0b24e018ab61d22b6bfd3ec&sharingv2=true&fromShare=true&at=9";

const AST_OFFSET_MS = 4 * 3600 * 1000;

type CalendarHeaderState = {
  activeMonth: string;
  activeYear: number;
  activeType: string;
};

type CalendarHeaderContextValue = CalendarHeaderState & {
  setHeaderState: (next: CalendarHeaderState) => void;
};

const CalendarHeaderContext = createContext<CalendarHeaderContextValue | null>(null);

export function CalendarHeaderProvider({
  initialMonth,
  children,
}: {
  initialMonth: string;
  children: React.ReactNode;
}) {
  const initialYear = Number(initialMonth.slice(0, 4));
  const [headerState, setHeaderStateRaw] = useState<CalendarHeaderState>(() => ({
    activeMonth: initialMonth,
    activeYear: Number.isFinite(initialYear) && initialYear >= 2000 ? initialYear : 2026,
    activeType: "ALL",
  }));

  const setHeaderState = useCallback((next: CalendarHeaderState) => {
    setHeaderStateRaw((prev) =>
      prev.activeMonth === next.activeMonth &&
      prev.activeYear === next.activeYear &&
      prev.activeType === next.activeType
        ? prev
        : next,
    );
  }, []);

  const value = useMemo(
    () => ({ ...headerState, setHeaderState }),
    [headerState, setHeaderState],
  );

  return (
    <CalendarHeaderContext.Provider value={value}>
      {children}
    </CalendarHeaderContext.Provider>
  );
}

export function useCalendarHeaderContext() {
  return useContext(CalendarHeaderContext);
}

function trinidadNowDate(): Date {
  return new Date(Date.now() - AST_OFFSET_MS);
}

function toTrinidadDateTimeLocal(iso: string | undefined, fallbackHour = 9): string {
  const fallback = () => {
    const ttNow = trinidadNowDate();
    const y = ttNow.getUTCFullYear();
    const m = String(ttNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ttNow.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}T${String(fallbackHour).padStart(2, "0")}:00`;
  };
  if (!iso) return fallback();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback();
  const tt = new Date(date.getTime() - AST_OFFSET_MS);
  const y = tt.getUTCFullYear();
  const m = String(tt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tt.getUTCDate()).padStart(2, "0");
  const hh = String(tt.getUTCHours()).padStart(2, "0");
  const mm = String(tt.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatAstTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Port_of_Spain",
  });
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function EventFormFields({
  event,
  defaultDate,
  staff = [],
  onSaved,
  onCancel,
}: {
  event?: EditableCalendarEvent | null;
  defaultDate?: string | null;
  staff?: StaffOption[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const isEdit = Boolean(event?.id);
  const serverAction = isEdit ? updateCalendarEventAction : createCalendarEventAction;
  const [state, action, pending] = useActionState<CalendarState, FormData>(serverAction, {});

  const defaultStart = useMemo(
    () =>
      event
        ? toTrinidadDateTimeLocal(event.starts_at, 9)
        : defaultDate
          ? `${defaultDate}T09:00`
          : toTrinidadDateTimeLocal(undefined, 9),
    [event, defaultDate],
  );
  const defaultEnd = useMemo(
    () =>
      event
        ? toTrinidadDateTimeLocal(event.ends_at, 17)
        : defaultDate
          ? `${defaultDate}T10:00`
          : toTrinidadDateTimeLocal(undefined, 10),
    [event, defaultDate],
  );

  // Controlled state preserves typed edits when React 19 resets uncontrolled
  // forms after a server validation error.
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventType, setEventType] = useState(event?.event_type ?? "MEETING");
  const [organiserId, setOrganiserId] = useState(
    event?.organiser_id ? String(event.organiser_id) : "",
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [startDt, setStartDt] = useState(defaultStart);
  const [endDt, setEndDt] = useState(defaultEnd);
  const [description, setDescription] = useState(event?.description ?? "");
  const [clientError, setClientError] = useState<string | null>(null);

  const visibleStaff = useMemo(() => {
    const list = staff.filter((person) => !person.inactive || person.id === event?.organiser_id);
    if (event?.organiser_id && !list.some((p) => p.id === event.organiser_id)) {
      list.push({
        id: event.organiser_id,
        name: event.organiser_name ?? `User #${event.organiser_id}`,
        inactive: true,
      });
    }
    return list;
  }, [staff, event?.organiser_id, event?.organiser_name]);

  useEffect(() => {
    if (!state.ok) return;
    if (!isEdit) {
      setTitle("");
      setEventType("MEETING");
      setOrganiserId("");
      setLocation("");
      setAllDay(false);
      setStartDt(defaultStart);
      setEndDt(defaultEnd);
      setDescription("");
    }
    setClientError(null);
    onSaved?.();
  }, [state.ok, isEdit, onSaved, defaultStart, defaultEnd]);

  const startDatePart = startDt.slice(0, 10);
  const endDatePart = endDt.slice(0, 10);
  const startTimePart = startDt.slice(11, 16) || "09:00";
  const endTimePart = endDt.slice(11, 16) || "17:00";

  const handleAllDayToggle = (checked: boolean) => {
    setAllDay(checked);
    setClientError(null);
    if (checked && endDatePart < startDatePart) {
      setEndDt(`${startDatePart}T17:00`);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setClientError(null);
    if (allDay) {
      if (!startDatePart || !endDatePart || endDatePart < startDatePart) {
        e.preventDefault();
        setClientError("End date must be on or after the start date.");
      }
    } else if (!startDt || !endDt || endDt <= startDt) {
      e.preventDefault();
      setClientError("End time must be after the start time.");
    }
  };

  const displayError = clientError ?? state.error;

  return (
    <form action={action} onSubmit={handleSubmit} className="space-y-3.5">
      {event?.id && <input type="hidden" name="id" value={event.id} />}

      <div>
        <label htmlFor={`${uid}-title`} className="label">
          Title
        </label>
        <input
          id={`${uid}-title`}
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field"
          placeholder="Staff meeting"
          maxLength={240}
          required
        />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-type`} className="label">
            Category
          </label>
          <select
            id={`${uid}-type`}
            name="event_type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="field"
          >
            <option value="MEETING">Meeting</option>
            <option value="MISSION">Mission / Field visit</option>
            <option value="LEAVE">Leave / Vacation</option>
            <option value="HOLIDAY">Public Holiday</option>
            <option value="DEADLINE">Deadline</option>
            <option value="OTHER">General</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-organiser`} className="label">
            Organiser
          </label>
          <FilterSelect
            id={`${uid}-organiser`}
            name="organiser_id"
            size="md"
            ariaLabel="Organiser"
            value={organiserId}
            onChange={setOrganiserId}
            options={[
              { value: "", label: "All staff" },
              ...visibleStaff.map((person) => ({
                value: String(person.id),
                label: person.inactive ? `${person.name} (inactive)` : person.name,
              })),
            ]}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-location`} className="label">
          Location
        </label>
        <input
          id={`${uid}-location`}
          name="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="field"
          placeholder="Conference room or Zoom link"
          maxLength={240}
        />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor={`${uid}-start`} className="label mb-0">
              {allDay ? "Start date (AST)" : "Starts (AST)"}
            </label>
            <label
              htmlFor={`${uid}-all-day`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70"
            >
              <input
                id={`${uid}-all-day`}
                type="checkbox"
                name="all_day"
                checked={allDay}
                onChange={(e) => handleAllDayToggle(e.target.checked)}
                className="rounded border-ink/25"
              />
              All-day event
            </label>
          </div>
          {allDay ? (
            <>
              <input type="hidden" name="starts_at" value={`${startDatePart}T09:00`} />
              <input
                id={`${uid}-start`}
                type="date"
                value={startDatePart}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setStartDt(`${nextDate}T${startTimePart}`);
                  if (nextDate && endDatePart && endDatePart < nextDate) {
                    setEndDt(`${nextDate}T${endTimePart}`);
                  }
                }}
                className="field bg-white"
                required
              />
            </>
          ) : (
            <input
              id={`${uid}-start`}
              type="datetime-local"
              name="starts_at"
              value={startDt}
              onChange={(e) => setStartDt(e.target.value)}
              className="field bg-white"
              required
            />
          )}
        </div>
        <div>
          <label htmlFor={`${uid}-end`} className="label">
            {allDay ? "End date (AST)" : "Ends (AST)"}
          </label>
          {allDay ? (
            <>
              <input type="hidden" name="ends_at" value={`${endDatePart}T17:00`} />
              <input
                id={`${uid}-end`}
                type="date"
                value={endDatePart}
                min={startDatePart}
                onChange={(e) => setEndDt(`${e.target.value}T${endTimePart}`)}
                className="field bg-white"
                required
              />
            </>
          ) : (
            <input
              id={`${uid}-end`}
              type="datetime-local"
              name="ends_at"
              value={endDt}
              min={startDt}
              onChange={(e) => setEndDt(e.target.value)}
              className="field bg-white"
              required
            />
          )}
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-description`} className="label">
          Notes
        </label>
        <textarea
          id={`${uid}-description`}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="field min-h-20"
          placeholder="Agenda or notes (optional)"
        />
      </div>

      {displayError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {displayError}
        </div>
      )}
      {state.ok && !displayError && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-iica-200 bg-iica-50 px-3.5 py-2.5 text-xs font-medium text-iica-800"
        >
          {state.message ?? "Saved."}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {(onCancel || onSaved) && (
          <button
            type="button"
            onClick={onCancel ?? onSaved}
            className="btn btn-ghost w-full sm:w-auto"
          >
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add to calendar"}
        </button>
      </div>
    </form>
  );
}

export function NewEventButton({ staff = [] }: { staff?: StaffOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New event
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule an event"
        description="Add an event to the office calendar."
      >
        {open && (
          <EventFormFields
            key="new-event"
            staff={staff}
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

const EXPORT_MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const bare = header.match(/filename=([^;\s]+)/i);
  return bare?.[1] ?? null;
}

export function ExportCalendarButton({
  initialMonth = "2026-11",
  todayKey,
  availableYears = [],
}: {
  initialMonth?: string;
  todayKey?: string;
  availableYears?: number[];
}) {
  const uid = useId();
  const headerCtx = useCalendarHeaderContext();
  const safeFallbackMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : "2026-11";
  const defaultYear = safeFallbackMonth.slice(0, 4);
  const initialDateStr =
    todayKey && ISO_DAY_RE.test(todayKey) ? todayKey : `${safeFallbackMonth}-01`;

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"month" | "day" | "week" | "year" | "custom" | "all">("month");
  const [date, setDate] = useState(initialDateStr);
  const [monthNum, setMonthNum] = useState(safeFallbackMonth.slice(5, 7));
  const [year, setYear] = useState(defaultYear);
  const [fromDate, setFromDate] = useState(`${defaultYear}-01-01`);
  const [toDate, setToDate] = useState(`${defaultYear}-12-31`);
  const [category, setCategory] = useState("ALL");
  const [format, setFormat] = useState<"xlsx" | "csv" | "ics" | "json">("xlsx");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const openModal = () => {
    setDownloadError(null);
    if (headerCtx) {
      const ctxYear = String(headerCtx.activeYear);
      setYear(ctxYear);
      setCategory(headerCtx.activeType || "ALL");
      if (headerCtx.activeMonth === "all") {
        setScope("year");
      } else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(headerCtx.activeMonth)) {
        setScope("month");
        setYear(headerCtx.activeMonth.slice(0, 4));
        setMonthNum(headerCtx.activeMonth.slice(5, 7));
      }
      setFromDate(`${ctxYear}-01-01`);
      setToDate(`${ctxYear}-12-31`);
    }
    setOpen(true);
  };

  const yearOptions = useMemo(() => {
    const baseYear = Number(defaultYear) || 2026;
    const set = new Set<number>([
      baseYear - 1,
      baseYear,
      baseYear + 1,
      Number(year) || baseYear,
      ...availableYears,
    ]);
    return [...set].filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100).sort((a, b) => a - b);
  }, [defaultYear, year, availableYears]);

  const dateValidationError = useMemo(() => {
    if ((scope === "day" || scope === "week") && !ISO_DAY_RE.test(date)) {
      return "Choose a valid date to export.";
    }
    if (scope === "custom") {
      if (!ISO_DAY_RE.test(fromDate) || !ISO_DAY_RE.test(toDate)) {
        return "Choose both start and end dates.";
      }
      if (fromDate > toDate) {
        return "Start date must be on or before end date.";
      }
    }
    return null;
  }, [scope, date, fromDate, toDate]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("scope", scope);
    if (category !== "ALL") params.set("type", category);
    if (scope === "day" || scope === "week") params.set("date", date);
    else if (scope === "month") params.set("month", `${year}-${monthNum}`);
    else if (scope === "year") params.set("year", year);
    else if (scope === "custom") {
      params.set("from", fromDate);
      params.set("to", toDate);
    }
    return `/api/export/calendar?${params.toString()}`;
  }, [format, scope, category, date, year, monthNum, fromDate, toDate]);

  const handleDownload = async () => {
    if (dateValidationError || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(exportHref, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setDownloadError(body.trim() || `Export failed (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const filename =
        parseContentDispositionFilename(res.headers.get("content-disposition")) ??
        `tt-delegation-calendar.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download calendar export.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={openModal}>
        <Download size={15} /> Export
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Export calendar"
        description="Download events by day, week, month, year, or full calendar."
      >
        <div className="space-y-4">
          <div>
            <span className="label">Period</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "month", label: "Monthly" },
                  { id: "day", label: "Daily" },
                  { id: "week", label: "Weekly" },
                  { id: "year", label: "Yearly" },
                  { id: "custom", label: "Custom" },
                  { id: "all", label: "All events" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={scope === item.id}
                  onClick={() => {
                    setScope(item.id);
                    setDownloadError(null);
                  }}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    scope === item.id
                      ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                      : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            {scope === "month" && (
              <div>
                <label htmlFor={`${uid}-month`} className="label">
                  Month &amp; year
                </label>
                <div className="flex gap-2">
                  <select
                    id={`${uid}-month`}
                    value={monthNum}
                    onChange={(e) => setMonthNum(e.target.value)}
                    className="field flex-1 text-xs"
                    aria-label="Export month"
                  >
                    {EXPORT_MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select
                    id={`${uid}-month-year`}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="field w-24 text-xs"
                    aria-label="Export year"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {(scope === "day" || scope === "week") && (
              <div>
                <label htmlFor={`${uid}-date`} className="label">
                  {scope === "day" ? "Date" : "Week containing"}
                </label>
                <input
                  id={`${uid}-date`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="field text-xs"
                  required
                />
              </div>
            )}

            {scope === "year" && (
              <div>
                <label htmlFor={`${uid}-year`} className="label">
                  Year
                </label>
                <select
                  id={`${uid}-year`}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="field text-xs"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scope === "custom" && (
              <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${uid}-from`} className="label">
                    From
                  </label>
                  <input
                    id={`${uid}-from`}
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="field text-xs"
                    required
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-to`} className="label">
                    To
                  </label>
                  <input
                    id={`${uid}-to`}
                    type="date"
                    value={toDate}
                    min={fromDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="field text-xs"
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor={`${uid}-category`} className="label">
                Category
              </label>
              <select
                id={`${uid}-category`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="field text-xs"
              >
                <option value="ALL">All categories</option>
                <option value="MEETING">Meetings</option>
                <option value="MISSION">Missions</option>
                <option value="LEAVE">Leave &amp; Vacation</option>
                <option value="HOLIDAY">Public Holidays</option>
                <option value="DEADLINE">Deadlines</option>
                <option value="OTHER">General</option>
              </select>
            </div>
          </div>

          <div>
            <span className="label">Format</span>
            <div className="grid gap-2 sm:grid-cols-4">
              {(
                [
                  { key: "xlsx", label: "Excel", hint: ".xlsx", icon: FileSpreadsheet },
                  { key: "csv", label: "CSV", hint: ".csv", icon: FileText },
                  { key: "ics", label: "iCalendar", hint: ".ics", icon: Calendar },
                  { key: "json", label: "JSON", hint: ".json", icon: FileJson },
                ] as const
              ).map(({ key, label, hint, icon: Icon }) => {
                const active = format === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFormat(key)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      active
                        ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                        : "border-ink/12 bg-white text-ink hover:border-iica-300 hover:bg-iica-50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-white" : "text-ink/55"} />
                    <div className="mt-1.5 text-xs font-semibold">{label}</div>
                    <div className={`text-[11px] ${active ? "text-white/80" : "text-ink/60"}`}>
                      {hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {(dateValidationError || downloadError) && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
            >
              {dateValidationError ?? downloadError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-ink/8 pt-3.5">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || Boolean(dateValidationError)}
              className="btn btn-primary"
            >
              <Download size={15} /> {downloading ? "Preparing…" : "Download"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ImportCalendarModalBody({ syncConfig }: { syncConfig?: SyncConfigClientProps }) {
  const uid = useId();
  const router = useRouter();
  const [tab, setTab] = useState<"sharepoint" | "webhook" | "upload" | "timelines">("sharepoint");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullResult, setPullResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Controlled SharePoint settings so React 19 form action errors preserve edits
  const [spUrl, setSpUrl] = useState(syncConfig?.sharepointUrl || SHAREPOINT_DEFAULT_URL);
  const [spInterval, setSpInterval] = useState(
    String(syncConfig?.syncIntervalMinutes ?? 15),
  );
  const [spAutoSync, setSpAutoSync] = useState(syncConfig?.autoSyncEnabled ?? true);
  const [spPruneDeleted, setSpPruneDeleted] = useState(syncConfig?.pruneDeleted ?? true);

  // Controlled Upload options
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadUpdateExisting, setUploadUpdateExisting] = useState(true);
  const [uploadPruneDeleted, setUploadPruneDeleted] = useState(true);

  const [uploadState, uploadAction, uploadPending] = useActionState<CalendarState, FormData>(
    importCalendarAction,
    {},
  );
  const [spState, spAction, spPending] = useActionState<CalendarState, FormData>(
    syncSharePointCalendarAction,
    {},
  );
  const [tlState, tlAction, tlPending] = useActionState<CalendarState, FormData>(
    syncTimelinesToCalendarAction,
    {},
  );

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/calendar/sync`
      : "/api/calendar/sync";

  const copyText = async (key: string, value: string) => {
    setCopyError(null);
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyError("Clipboard access is unavailable in this browser context. Select and copy manually.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      setCopyError("Could not copy to clipboard. Check browser permissions or copy manually.");
    }
  };

  const triggerManualSharePointPull = async () => {
    setPullLoading(true);
    setPullResult(null);
    try {
      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        unchanged?: boolean;
      };
      if (res.ok && data.ok) {
        setPullResult({
          ok: true,
          message: data.message ?? "SharePoint pull completed successfully.",
        });
        router.refresh();
      } else {
        setPullResult({
          ok: false,
          message: data.error || data.message || `SharePoint pull failed (HTTP ${res.status}).`,
        });
        router.refresh();
      }
    } catch (err) {
      setPullResult({
        ok: false,
        message: err instanceof Error ? err.message : "Could not reach /api/calendar/sync.",
      });
    } finally {
      setPullLoading(false);
    }
  };

  const downloadPowerAutomateTemplate = () => {
    const template = {
      name: "IICA-TT 2026 Calendar Instant Push Sync",
      description:
        "Automatically pushes updates from 2026 Team-TT Calendar.xlsx on SharePoint to the IICA-TT Calendar API whenever the workbook is modified.",
      workbookUrl: spUrl || SHAREPOINT_DEFAULT_URL,
      trigger: {
        connector: "SharePoint / OneDrive for Business",
        event: "When a file is modified",
        fileName: "2026 Team-TT Calendar.xlsx",
      },
      action: {
        connector: "HTTP",
        method: "POST",
        uri: webhookUrl,
        headers: {
          "x-sync-key": syncConfig?.webhookSecret || "<YOUR_CALENDAR_SYNC_SECRET>",
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        bodyExpression: "@triggerBody()",
      },
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "iica-tt-calendar-instant-push-flow.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const formattedLastSynced = formatAstTimestamp(syncConfig?.lastSyncedAt);
  const formattedLastAttempted = formatAstTimestamp(syncConfig?.lastAttemptedAt);
  const status = syncConfig?.lastStatus || "READY";

  const statusTone =
    status === "SYNCED"
      ? {
          box: "border-emerald-200 bg-emerald-50/80 text-emerald-900",
          sub: "text-emerald-800/85",
          meta: "text-emerald-700",
          heading: "Sync Healthy · Instant Push Ready",
          Icon: CheckCircle2,
          iconClass: "text-emerald-600",
        }
      : status === "AUTH_REQUIRED"
        ? {
            box: "border-gold-400/45 bg-gold-400/10 text-ink",
            sub: "text-ink/75",
            meta: "text-gold-700",
            heading: "SharePoint Sign-in Required (Use Instant Push)",
            Icon: AlertTriangle,
            iconClass: "text-gold-700",
          }
        : status === "ERROR"
          ? {
              box: "border-rose-200 bg-rose-50 text-rose-900",
              sub: "text-rose-800",
              meta: "text-rose-700",
              heading: "Last Sync Failed",
              Icon: AlertCircle,
              iconClass: "text-rose-600",
            }
          : {
              box: "border-iica-200 bg-iica-50/70 text-iica-900",
              sub: "text-iica-800/80",
              meta: "text-iica-700",
              heading: "Ready for Sync / Webhook Push",
              Icon: Info,
              iconClass: "text-iica-700",
            };

  const StatusIcon = statusTone.Icon;
  const isNonGridFile = /\.(csv|ics)$/i.test(uploadFileName);
  const openSharePointHref = isSafeHttpUrl(spUrl) ? spUrl.trim() : SHAREPOINT_DEFAULT_URL;

  return (
    <>
      <div
        role="group"
        aria-label="Sync and import options"
        className="mb-4 flex flex-wrap items-center gap-1.5"
      >
        {(
          [
            { id: "sharepoint", label: "Auto-Pull", icon: <CloudDownload size={13} /> },
            { id: "webhook", label: "Instant Push", icon: <Webhook size={13} /> },
            { id: "upload", label: "Upload", icon: <FileSpreadsheet size={13} /> },
            { id: "timelines", label: "Timelines", icon: <FolderSync size={13} /> },
          ] as const
        ).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(item.id)}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                active
                  ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                  : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
              }`}
            >
              {item.icon} {item.label}
            </button>
          );
        })}
      </div>

      {tab === "sharepoint" && (
        <div className="animate-fade space-y-4">
          <form action={spAction} className="space-y-3.5">
            <div>
              <label htmlFor={`${uid}-sp-url`} className="label">
                Workbook URL
              </label>
              <input
                id={`${uid}-sp-url`}
                type="url"
                name="sharepoint_url"
                value={spUrl}
                onChange={(e) => setSpUrl(e.target.value)}
                className="field text-xs"
                placeholder="https://iicaint-my.sharepoint.com/..."
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-sp-interval`} className="label">
                  Check every
                </label>
                <select
                  id={`${uid}-sp-interval`}
                  name="sync_interval_minutes"
                  value={spInterval}
                  onChange={(e) => setSpInterval(e.target.value)}
                  className="field bg-white py-1.5 text-xs"
                >
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="360">6 hours</option>
                  <option value="1440">Daily</option>
                </select>
              </div>

              <div className="flex flex-col justify-center gap-2 pt-1">
                <label
                  htmlFor={`${uid}-sp-auto`}
                  className="flex items-center gap-2 text-xs font-medium text-ink/75"
                >
                  <input
                    id={`${uid}-sp-auto`}
                    type="checkbox"
                    name="auto_sync_enabled"
                    checked={spAutoSync}
                    onChange={(e) => setSpAutoSync(e.target.checked)}
                  />
                  Auto-sync in background
                </label>
                <label
                  htmlFor={`${uid}-sp-prune`}
                  className="flex items-center gap-2 text-xs font-medium text-ink/75"
                >
                  <input
                    id={`${uid}-sp-prune`}
                    type="checkbox"
                    name="prune_deleted"
                    checked={spPruneDeleted}
                    onChange={(e) => setSpPruneDeleted(e.target.checked)}
                  />
                  Remove deleted rows
                </label>
              </div>
            </div>

            {syncConfig?.lastMessage && !spState.error && !spState.ok && (
              <div className="rounded-xl border border-ink/8 bg-white px-3 py-2 text-[11px] text-ink/65">
                <span className="font-semibold text-ink/80">Last sync ({status}): </span>
                {syncConfig.lastMessage}
                {formattedLastAttempted && (
                  <span className="ml-1 text-ink/50">· Attempted {formattedLastAttempted} AST</span>
                )}
              </div>
            )}

            {spState.error && spState.needsAuth && (
              <div
                role="alert"
                className="space-y-2 rounded-xl border border-gold-400/45 bg-gold-400/10 p-3 text-xs text-ink/80"
              >
                <div className="font-semibold text-gold-700">SharePoint sign-in required</div>
                <p className="text-ink/70">{spState.error}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTab("webhook")}
                    className="btn btn-primary px-3 py-1.5 text-xs"
                  >
                    <Webhook size={13} /> Use Instant Push
                  </button>
                </div>
              </div>
            )}

            {spState.error && !spState.needsAuth && (
              <div
                role="alert"
                className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
              >
                <div className="font-semibold">SharePoint sync failed</div>
                <p>{spState.error}</p>
              </div>
            )}

            {spState.ok && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 rounded-xl border border-iica-200 bg-iica-50 p-3 text-xs font-medium text-iica-800"
              >
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-iica-700" />
                <span>{spState.message}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn btn-primary flex-1" disabled={spPending}>
                <RefreshCw size={14} className={spPending ? "animate-spin" : ""} />
                {spPending ? "Syncing…" : "Save & Sync Now"}
              </button>
              <a
                href={openSharePointHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost text-xs"
              >
                <ExternalLink size={14} /> Open SharePoint
              </a>
            </div>
          </form>
        </div>
      )}

      {tab === "webhook" && (
        <div className="animate-fade space-y-3.5">
          <div className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${statusTone.box}`}>
            <StatusIcon size={16} className={`mt-0.5 shrink-0 ${statusTone.iconClass}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                <span>{statusTone.heading}</span>
                {formattedLastSynced && (
                  <span className={`text-[11px] font-medium ${statusTone.meta}`}>
                    Last synced {formattedLastSynced} AST
                  </span>
                )}
              </div>
              {formattedLastAttempted && formattedLastAttempted !== formattedLastSynced && (
                <p className={`mt-0.5 text-[11px] ${statusTone.meta}`}>
                  Last attempt: {formattedLastAttempted} AST
                </p>
              )}
              {syncConfig?.lastMessage && (
                <p className={`mt-0.5 text-[11px] ${statusTone.sub}`}>
                  {syncConfig.lastMessage}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={triggerManualSharePointPull}
              disabled={pullLoading}
              className="btn btn-primary flex-1 text-xs"
            >
              <RefreshCw size={14} className={pullLoading ? "animate-spin" : ""} />
              {pullLoading ? "Pulling…" : "Run SharePoint Pull Sync"}
            </button>
            <button
              type="button"
              onClick={downloadPowerAutomateTemplate}
              className="btn btn-ghost text-xs"
            >
              <Download size={14} /> Download Flow (.json)
            </button>
          </div>

          {pullResult && (pullResult.ok || pullResult.message !== syncConfig?.lastMessage) && (
            <div
              role={pullResult.ok ? "status" : "alert"}
              aria-live="polite"
              className={`flex items-start gap-2 rounded-xl border p-3 text-xs font-medium ${
                pullResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {pullResult.ok && (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              )}
              <span>{pullResult.message}</span>
            </div>
          )}

          {copyError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
            >
              {copyError}
            </div>
          )}

          <div>
            <label htmlFor={`${uid}-webhook-url`} className="label">
              Webhook URL
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${uid}-webhook-url`}
                readOnly
                value={webhookUrl}
                className="field bg-iica-50/40 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => copyText("url", webhookUrl)}
                className="btn btn-ghost shrink-0 px-3 py-2 text-xs"
              >
                <Copy size={13} /> {copiedField === "url" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {syncConfig?.webhookSecret && (
            <div>
              <label htmlFor={`${uid}-sync-key`} className="label">
                Sync key (x-sync-key)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`${uid}-sync-key`}
                  readOnly
                  value={syncConfig.webhookSecret}
                  className="field bg-iica-50/40 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => copyText("secret", syncConfig.webhookSecret!)}
                  className="btn btn-ghost shrink-0 px-3 py-2 text-xs"
                >
                  <Copy size={13} /> {copiedField === "secret" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-ink/60">
            In Power Automate, trigger when{" "}
            <code className="text-[11px]">2026 Team-TT Calendar.xlsx</code> is modified and send
            an HTTP POST with header <code className="text-[11px]">x-sync-key</code>.
          </p>
        </div>
      )}

      {tab === "upload" && (
        <form action={uploadAction} className="animate-fade space-y-4">
          <div>
            <label htmlFor={`${uid}-upload-file`} className="label">
              Calendar file (.xlsx, .csv, or .ics)
            </label>
            <input
              id={`${uid}-upload-file`}
              type="file"
              name="calendar_file"
              accept=".xlsx,.ics,.csv,text/calendar,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setUploadFileName(e.target.files?.[0]?.name ?? "")}
              className="field text-xs"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor={`${uid}-upload-update`}
              className="flex items-center gap-2 text-xs font-medium text-ink/75"
            >
              <input
                id={`${uid}-upload-update`}
                type="checkbox"
                name="update_existing"
                checked={uploadUpdateExisting}
                onChange={(e) => setUploadUpdateExisting(e.target.checked)}
              />
              Update existing events
            </label>
            <div>
              <label
                htmlFor={`${uid}-upload-prune`}
                className={`flex items-center gap-2 text-xs font-medium ${
                  isNonGridFile ? "text-ink/45" : "text-ink/75"
                }`}
              >
                <input
                  id={`${uid}-upload-prune`}
                  type="checkbox"
                  name="prune_deleted"
                  disabled={isNonGridFile}
                  checked={isNonGridFile ? false : uploadPruneDeleted}
                  onChange={(e) => setUploadPruneDeleted(e.target.checked)}
                />
                Remove deleted rows (IICA monthly grid .xlsx only)
              </label>
              {isNonGridFile ? (
                <p className="mt-1 pl-5 text-[11px] text-ink/60">
                  Row pruning only applies to IICA monthly grid (.xlsx) workbooks and is skipped for{" "}
                  {uploadFileName.split(".").pop()?.toUpperCase()} imports.
                </p>
              ) : (
                uploadPruneDeleted && (
                  <p className="mt-1 pl-5 text-[11px] text-gold-700">
                    Previously synced workbook events in touched months missing from an uploaded
                    grid workbook will be removed; manual events are kept.
                  </p>
                )
              )}
            </div>
          </div>

          {uploadState.error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"
            >
              {uploadState.error}
            </div>
          )}
          {uploadState.ok && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-iica-200 bg-iica-50 p-3 text-xs font-medium text-iica-800"
            >
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-iica-700" />
              <span>{uploadState.message}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={uploadPending}>
            <Upload size={14} />
            {uploadPending ? "Uploading…" : "Upload & sync"}
          </button>
        </form>
      )}

      {tab === "timelines" && (
        <form action={tlAction} className="animate-fade space-y-4">
          <p className="rounded-xl border border-ink/10 bg-iica-50/50 p-3 text-xs text-ink/75">
            Import dated tasks and deadlines from Timelines.
          </p>

          {tlState.error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"
            >
              {tlState.error}
            </div>
          )}
          {tlState.ok && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-iica-200 bg-iica-50 p-3 text-xs font-medium text-iica-800"
            >
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-iica-700" />
              <span>{tlState.message}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={tlPending}>
            <CalendarPlus size={14} />
            {tlPending ? "Syncing…" : "Sync timelines"}
          </button>
        </form>
      )}
    </>
  );
}

export function ImportCalendarButton({ syncConfig }: { syncConfig?: SyncConfigClientProps }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <RefreshCw size={15} />
        <span>Sync &amp; import</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Sync & import"
        description="Sync with SharePoint or upload a calendar file."
      >
        {open && <ImportCalendarModalBody syncConfig={syncConfig} />}
      </Modal>
    </>
  );
}
