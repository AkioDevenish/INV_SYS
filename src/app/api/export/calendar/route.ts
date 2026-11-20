import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/auth";
import { isValidCalendarDate } from "@/lib/calendar-import";
import { authenticateExportRequest, neutralizeFormulaString } from "@/lib/export";
import { can } from "@/lib/permissions";
import { listCalendarEvents } from "@/lib/queries";

export const maxDuration = 60;

const VALID_FORMATS = new Set(["xlsx", "csv", "ics", "json"]);
const VALID_SCOPES = new Set(["all", "day", "week", "month", "year", "custom"]);
const VALID_TYPES = new Set(["ALL", "MEETING", "MISSION", "LEAVE", "HOLIDAY", "DEADLINE", "OTHER"]);

const CATEGORY_LABELS: Record<string, string> = {
  MEETING: "Meeting",
  MISSION: "Mission",
  LEAVE: "Leave & Vacation",
  HOLIDAY: "Public Holiday",
  DEADLINE: "Deadline",
  OTHER: "General",
};

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function trinidadDayKey(d: Date): string {
  return new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function mondayOfWeek(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offset = (dt.getUTCDay() + 6) % 7;
  return addDaysToDayKey(dayKey, -offset);
}

function parseYmd(raw: string): { y: number; m: number; d: number } | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, yy, mm, dd] = m.map(Number);
  return isValidCalendarDate(yy, mm, dd) ? { y: yy, m: mm, d: dd } : null;
}

function parseYm(raw: string): { y: number; m: number } | null {
  const m = raw.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  return yy >= 1970 && yy <= 2100 && mm >= 1 && mm <= 12 ? { y: yy, m: mm } : null;
}

function formatAstTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Port_of_Spain",
  });
}

function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function escapeIcsText(val: string): string {
  return val
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds an iCalendar content line at <= 75 UTF-8 octets per RFC 5545 Section 3.1
 * without splitting multi-byte UTF-8 characters.
 */
function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const segments: string[] = [];
  let current = "";
  let limit = 75;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    const curBytes = Buffer.byteLength(current, "utf8");
    if (curBytes + chBytes > limit && current.length > 0) {
      segments.push(current);
      current = ` ${ch}`;
      limit = 75;
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);
  return segments.join("\r\n");
}

function csvCell(value: string): string {
  const safe = neutralizeFormulaString(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function isExactAstMidnight(d: Date): boolean {
  return d.getUTCHours() === 4 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

export async function GET(req: Request) {
  const auth = await authenticateExportRequest(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!(await can(user.role, "calendar.view"))) {
    return new NextResponse("Forbidden", { status: 403, headers: SECURITY_HEADERS });
  }

  const params = new URL(req.url).searchParams;
  const rawFormat = params.get("format")?.toLowerCase() ?? "csv";
  if (!VALID_FORMATS.has(rawFormat)) {
    return new NextResponse("Invalid export format.", { status: 400, headers: SECURITY_HEADERS });
  }
  const format = rawFormat as "xlsx" | "csv" | "ics" | "json";

  const scope = (params.get("scope") ?? "all").toLowerCase();
  if (!VALID_SCOPES.has(scope)) {
    return new NextResponse("Invalid export scope.", { status: 400, headers: SECURITY_HEADERS });
  }

  const typeParam = (params.get("type") ?? "ALL").toUpperCase();
  if (!VALID_TYPES.has(typeParam)) {
    return new NextResponse("Invalid event type filter.", { status: 400, headers: SECURITY_HEADERS });
  }

  const todayAst = trinidadDayKey(new Date());
  const dateParam = params.get("date") ?? todayAst;
  const monthParam = params.get("month") ?? todayAst.slice(0, 7);
  const yearParam = params.get("year") ?? todayAst.slice(0, 4);
  const fromParam = params.get("from") ?? `${yearParam}-01-01`;
  const toParam = params.get("to") ?? `${yearParam}-12-31`;

  let rangeStart = "0000-01-01";
  let rangeEnd = "9999-12-31";
  let fileSuffix = "all";

  if (scope === "day") {
    if (!parseYmd(dateParam)) {
      return new NextResponse("Invalid date parameter.", { status: 400, headers: SECURITY_HEADERS });
    }
    rangeStart = dateParam;
    rangeEnd = dateParam;
    fileSuffix = dateParam;
  } else if (scope === "week") {
    if (!parseYmd(dateParam)) {
      return new NextResponse("Invalid week date parameter.", { status: 400, headers: SECURITY_HEADERS });
    }
    rangeStart = mondayOfWeek(dateParam);
    rangeEnd = addDaysToDayKey(rangeStart, 6);
    fileSuffix = `week-${rangeStart}`;
  } else if (scope === "month") {
    const parsed = parseYm(monthParam);
    if (!parsed) {
      return new NextResponse("Invalid month parameter.", { status: 400, headers: SECURITY_HEADERS });
    }
    const lastDay = String(new Date(Date.UTC(parsed.y, parsed.m, 0)).getUTCDate()).padStart(2, "0");
    rangeStart = `${monthParam}-01`;
    rangeEnd = `${monthParam}-${lastDay}`;
    fileSuffix = monthParam;
  } else if (scope === "year") {
    const y = Number(yearParam);
    if (!/^\d{4}$/.test(yearParam) || y < 1970 || y > 2100) {
      return new NextResponse("Invalid year parameter.", { status: 400, headers: SECURITY_HEADERS });
    }
    rangeStart = `${yearParam}-01-01`;
    rangeEnd = `${yearParam}-12-31`;
    fileSuffix = yearParam;
  } else if (scope === "custom") {
    if (!parseYmd(fromParam) || !parseYmd(toParam)) {
      return new NextResponse("Invalid custom date range.", { status: 400, headers: SECURITY_HEADERS });
    }
    rangeStart = fromParam <= toParam ? fromParam : toParam;
    rangeEnd = fromParam <= toParam ? toParam : fromParam;
    fileSuffix = `${rangeStart}-to-${rangeEnd}`;
  }

  const queryStart =
    scope === "all"
      ? new Date("2000-01-01T00:00:00Z")
      : new Date(`${addDaysToDayKey(rangeStart, -1)}T00:00:00Z`);
  const queryEnd =
    scope === "all"
      ? new Date("2100-01-01T00:00:00Z")
      : new Date(`${addDaysToDayKey(rangeEnd, 2)}T00:00:00Z`);

  const allEvents = await listCalendarEvents(queryStart, queryEnd);

  const filtered = allEvents.filter((event) => {
    if (typeParam !== "ALL" && event.event_type !== typeParam) return false;
    if (scope === "all") return true;
    const evStart = trinidadDayKey(event.starts_at);
    const evEnd = trinidadDayKey(event.ends_at);
    return evEnd >= rangeStart && evStart <= rangeEnd;
  });

  const rows = filtered.map((event) => {
    const startDay = trinidadDayKey(event.starts_at);
    const rawEndDay = trinidadDayKey(event.ends_at);
    const endDay =
      event.all_day && isExactAstMidnight(event.ends_at) && rawEndDay > startDay
        ? addDaysToDayKey(rawEndDay, -1)
        : rawEndDay;
    const title = event.title;
    const description = event.description ?? "";
    const category = CATEGORY_LABELS[event.event_type] ?? event.event_type;
    return {
      date: startDay,
      endDate: endDay >= startDay ? endDay : startDay,
      startTime: event.all_day ? "All day" : formatAstTime(event.starts_at),
      endTime: event.all_day ? "All day" : formatAstTime(event.ends_at),
      allDay: event.all_day ? "Yes" : "No",
      category,
      title,
      organiser: event.organiser_name ?? "",
      location: event.location ?? "",
      description,
      startsAt: event.starts_at.toISOString(),
      endsAt: event.ends_at.toISOString(),
      raw: event,
    };
  });

  const baseName = `tt-delegation-calendar-${fileSuffix}`;

  try {
    await recordAudit({
      user,
      action: "EXPORT",
      entity: "calendar_event",
      details: `Format: ${format.toUpperCase()} · Scope: ${scope} · Type: ${typeParam} · Rows: ${rows.length}`,
    });
  } catch (err) {
    console.error("Failed to record calendar export audit entry:", err);
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "IICA-TT Internal System";
    wb.created = new Date();
    const ws = wb.addWorksheet("TT Delegation Calendar", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "End Date", key: "endDate", width: 14 },
      { header: "Start Time (AST)", key: "startTime", width: 16 },
      { header: "End Time (AST)", key: "endTime", width: 16 },
      { header: "All Day", key: "allDay", width: 10 },
      { header: "Category", key: "category", width: 18 },
      { header: "Title", key: "title", width: 48 },
      { header: "Organiser", key: "organiser", width: 22 },
      { header: "Location", key: "location", width: 24 },
      { header: "Notes", key: "description", width: 42 },
    ];
    for (const r of rows) {
      ws.addRow({
        date: r.date,
        endDate: r.endDate,
        startTime: r.startTime,
        endTime: r.endTime,
        allDay: r.allDay,
        category: r.category,
        title: neutralizeFormulaString(r.title),
        organiser: neutralizeFormulaString(r.organiser),
        location: neutralizeFormulaString(r.location),
        description: neutralizeFormulaString(r.description),
      });
    }
    const headerRow = ws.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14477D" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 10 },
    };

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  }

  if (format === "ics") {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//IICA-TT//Delegation Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:TT Delegation Calendar",
    ];

    for (const r of rows) {
      const ev = r.raw as typeof r.raw & { updated_at?: Date | null; source_key?: string | null };
      const stampSource = ev.updated_at ?? ev.starts_at;
      const uid = ev.source_key
        ? `iica-tt-${createHash("sha256").update(ev.source_key).digest("hex").slice(0, 16)}@iica.int`
        : `iica-tt-${ev.id}@iica.int`;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${toIcsUtc(stampSource)}`);
      if (ev.updated_at) {
        lines.push(`LAST-MODIFIED:${toIcsUtc(ev.updated_at)}`);
      }
      if (ev.all_day) {
        const sDay = r.date;
        const exclusiveEnd = addDaysToDayKey(r.endDate, 1);
        lines.push(`DTSTART;VALUE=DATE:${sDay.replaceAll("-", "")}`);
        lines.push(`DTEND;VALUE=DATE:${exclusiveEnd.replaceAll("-", "")}`);
      } else {
        lines.push(`DTSTART:${toIcsUtc(ev.starts_at)}`);
        lines.push(`DTEND:${toIcsUtc(ev.ends_at)}`);
      }
      lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(r.title)}`));
      lines.push(foldIcsLine(`CATEGORIES:${escapeIcsText(r.category)}`));
      if (r.location) lines.push(foldIcsLine(`LOCATION:${escapeIcsText(r.location)}`));
      const descParts = [
        r.organiser ? `Organiser: ${r.organiser}` : "",
        r.description,
      ].filter(Boolean);
      if (descParts.length > 0) {
        lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`));
      }
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    const icsBody = `${lines.join("\r\n")}\r\n`;
    return new NextResponse(icsBody, {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.ics"`,
      },
    });
  }

  if (format === "json") {
    const payload = rows.map(({ raw: _raw, ...clean }) => clean);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.json"`,
      },
    });
  }

  const header = [
    "Date",
    "End Date",
    "Start Time (AST)",
    "End Time (AST)",
    "All Day",
    "Category",
    "Title",
    "Organiser",
    "Location",
    "Notes",
  ];
  const csvRows = rows.map((r) => [
    r.date,
    r.endDate,
    r.startTime,
    r.endTime,
    r.allDay,
    r.category,
    r.title,
    r.organiser,
    r.location,
    r.description,
  ]);
  const csv = [header, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  });
}
