import "server-only";
import ExcelJS from "exceljs";
import { isPriority, isTaskStatus, isValidIsoDate, type TaskStatus } from "./timelines";

/**
 * Reads a targets-and-timelines workbook.
 *
 * The three sheets are laid out differently on purpose, so each is detected by
 * its own header rather than forced into one shape:
 *
 *   activity  # | Action | Lead | Origin | Priority | Month | Start | End | Time | D NS O C | Comments
 *   monthly   # | Action | Lead | Origin | Priority | Sep | Oct | Nov | Dec | Time | Comments
 *   personal  # | Task | Origin | Due date | Progress | Comments
 */

export type ImportedTask = {
  area: string;
  position: number | null;
  title: string;
  lead: string | null;
  origin: string | null;
  priority: string;
  status: TaskStatus;
  progress: number | null;
  startsOn: string | null;
  endsOn: string | null;
  scheduleNote: string | null;
  comments: string | null;
};

export type TimelineImportReport = {
  tasks: ImportedTask[];
  skipped: { row: string; reason: string }[];
  sheets: { name: string; shape: string; rows: number }[];
};

function unwrapCellValue(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const v = value as Record<string, unknown>;
    if ("error" in v) return null;
    if (v.result !== undefined) return unwrapCellValue(v.result);
    if (v.text !== undefined) return unwrapCellValue(v.text);
  }
  return value;
}

function cellText(value: unknown): string {
  const raw = unwrapCellValue(value);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "";
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "object") {
    const v = raw as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
    }
    if (typeof v.hyperlink === "string") {
      return v.hyperlink.replace(/^mailto:/i, "").trim();
    }
  }
  return "";
}

const EXACT_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function exactMonthHeader(raw: string): number | null {
  return EXACT_MONTHS[raw.toLowerCase().trim()] ?? null;
}

function parseMonthCell(value: unknown): number | null {
  const unwrapped = unwrapCellValue(value);
  if (unwrapped instanceof Date && !Number.isNaN(unwrapped.getTime())) {
    return unwrapped.getUTCMonth() + 1;
  }
  const text = cellText(unwrapped).toLowerCase();
  if (!text) return null;
  if (text in EXACT_MONTHS) return EXACT_MONTHS[text];
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  return match ? (EXACT_MONTHS[match[1].toLowerCase()] ?? null) : null;
}

function formatValidIsoDate(year: number, month: number, day: number): string | null {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * The sheets carry a month name and a bare day number rather than a full date,
 * so the year has to come from somewhere. Also handles Excel Date cells and
 * day ranges like "1-3" without corrupting them into "13" or "20260915".
 */
function buildDate(
  year: number,
  month: number | null,
  value: unknown,
  bound: "start" | "end",
): string | null {
  const unwrapped = unwrapCellValue(value);
  if (unwrapped instanceof Date && !Number.isNaN(unwrapped.getTime())) {
    const iso = unwrapped.toISOString().slice(0, 10);
    return isValidIsoDate(iso) ? iso : null;
  }

  const raw = cellText(unwrapped);
  if (!raw) return null;
  if (isValidIsoDate(raw)) return raw;
  if (!month) return null;

  const rangeMatch = raw.match(
    /^\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:-|–|to)\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*$/i,
  );
  if (rangeMatch) {
    const day = Number(bound === "start" ? rangeMatch[1] : rangeMatch[2]);
    return formatValidIsoDate(year, month, day);
  }

  const singleMatch = raw.match(/^\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*$/i);
  if (singleMatch) {
    return formatValidIsoDate(year, month, Number(singleMatch[1]));
  }

  return null;
}

const FALSY_MARKS = new Set(["", "no", "n", "0", "-", "--", "none", "false", "n/a", "na"]);

function isMarked(raw: string): boolean {
  return !FALSY_MARKS.has(raw.trim().toLowerCase());
}

/** D / NS / O / C marks in the status columns, ignoring "No"/"0"/"-" placeholders. */
function statusFromMarks(marks: { d: string; ns: string; o: string; c: string }): TaskStatus {
  if (isMarked(marks.c)) return "COMPLETE";
  if (isMarked(marks.d)) return "DELAYED";
  if (isMarked(marks.o)) return "ONGOING";
  void marks.ns;
  return "NOT_STARTED";
}

function headerIndex(sheet: ExcelJS.Worksheet, row: number): Record<string, number> {
  const found: Record<string, number> = {};
  sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
    const label = cellText(cell.value).toLowerCase().replace(/\s+/g, " ").trim();
    if (label && !(label in found)) found[label] = col;
  });
  return found;
}

function colOf(headers: Record<string, number>, aliases: string[], fallback?: number): number | undefined {
  for (const alias of aliases) {
    if (alias in headers) return headers[alias];
  }
  return fallback;
}

function scoreTimelineHeaders(h: Record<string, number>): number {
  const known = ["#", "action", "task", "lead", "origin", "priority", "month", "start", "end", "due date", "progress", "time", "comments"];
  let score = known.filter((k) => k in h).length;
  for (const k of Object.keys(h)) {
    if (exactMonthHeader(k) !== null) score++;
  }
  return score;
}

function parsePersonalProgress(cell: ExcelJS.Cell): number | null {
  const raw = cellText(cell.value);
  if (!raw) return null;
  const hasPercentSign = raw.endsWith("%");
  const numStr = hasPercentSign ? raw.slice(0, -1).trim() : raw;
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;

  const isPercentFmt = typeof cell.numFmt === "string" && cell.numFmt.includes("%");
  const scaled = hasPercentSign ? n : isPercentFmt || (n >= 0 && n <= 1) ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export async function parseTimelineWorkbook(
  buffer: ArrayBuffer,
  year: number,
): Promise<TimelineImportReport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const tasks: ImportedTask[] = [];
  const skipped: TimelineImportReport["skipped"] = [];
  const sheets: TimelineImportReport["sheets"] = [];

  for (const sheet of workbook.worksheets) {
    const area = sheet.name.trim();
    const h2 = headerIndex(sheet, 2);
    const h1 = headerIndex(sheet, 1);
    const useRow1 = scoreTimelineHeaders(h2) < 2 && scoreTimelineHeaders(h1) >= 2;
    const h = useRow1 ? h1 : h2;
    const dataStartRow = useRow1 ? 2 : 3;

    const monthHeaders = Object.entries(h).filter(([name]) => exactMonthHeader(name) !== null);
    const personal = "due date" in h || ("task" in h && "progress" in h);
    const monthly = !personal && monthHeaders.length >= 2;
    const activity =
      !personal &&
      !monthly &&
      ("action" in h || "task" in h || "lead" in h || "month" in h || "start" in h || "end" in h);

    if (!personal && !monthly && !activity) {
      skipped.push({ row: area, reason: "Unrecognised header layout" });
      continue;
    }

    const shape = personal ? "personal" : monthly ? "monthly" : "activity";
    let rows = 0;

    const posCol = colOf(h, ["#", "no", "no."], 1)!;
    const titleCol = colOf(h, ["task", "action", "title"], 2)!;

    for (let r = dataStartRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const title = cellText(row.getCell(titleCol).value);
      const firstCellText = cellText(row.getCell(1).value);
      // Section banners repeat one label across the row and carry no task.
      if (!title || title === firstCellText) continue;

      const positionRaw = cellText(row.getCell(posCol).value);
      const position = /^\d+$/.test(positionRaw) ? Number(positionRaw) : null;

      if (personal) {
        const originCol = colOf(h, ["origin", "source"], 3)!;
        const dueCol = colOf(h, ["due date", "due", "deadline"], 4)!;
        const progressCol = colOf(h, ["progress", "% complete", "percent"], 5)!;
        const commentsCol = colOf(h, ["comments", "notes"], 6)!;

        const dueCellVal = row.getCell(dueCol).value;
        const dueText = cellText(dueCellVal);
        const endsOn =
          dueCellVal instanceof Date
            ? formatValidIsoDate(
                dueCellVal.getUTCFullYear(),
                dueCellVal.getUTCMonth() + 1,
                dueCellVal.getUTCDate(),
              )
            : isValidIsoDate(dueText)
              ? dueText
              : null;

        const progress = parsePersonalProgress(row.getCell(progressCol));
        const status: TaskStatus =
          progress === null || progress === 0
            ? "NOT_STARTED"
            : progress >= 100
              ? "COMPLETE"
              : "ONGOING";

        tasks.push({
          area,
          position,
          title,
          lead: area,
          origin: cellText(row.getCell(originCol).value) || null,
          priority: "M",
          status,
          progress,
          startsOn: null,
          endsOn,
          scheduleNote: !endsOn && dueText ? dueText : null,
          comments: cellText(row.getCell(commentsCol).value) || null,
        });
        rows++;
        continue;
      }

      const leadCol = colOf(h, ["lead", "owner"], 3)!;
      const originCol = colOf(h, ["origin", "source"], 4)!;
      const priorityCol = colOf(h, ["priority"], 5)!;
      const priorityRaw = cellText(row.getCell(priorityCol).value).toUpperCase();
      const base = {
        area,
        position,
        title,
        lead: cellText(row.getCell(leadCol).value) || null,
        origin: cellText(row.getCell(originCol).value) || null,
        priority: isPriority(priorityRaw) ? priorityRaw : "M",
      };

      if (monthly) {
        const parts: string[] = [];
        for (const [name, col] of monthHeaders) {
          const day = cellText(row.getCell(col).value);
          if (day) parts.push(`${name[0].toUpperCase()}${name.slice(1)} ${day}`);
        }
        const timeCol = colOf(h, ["time", "schedule"]);
        const commentsCol = colOf(h, ["comments", "notes"]);
        const time = timeCol ? cellText(row.getCell(timeCol).value) : "";
        tasks.push({
          ...base,
          status: "ONGOING",
          progress: null,
          startsOn: null,
          endsOn: null,
          scheduleNote: [parts.join(" · "), time].filter(Boolean).join(" — ") || null,
          comments: commentsCol ? cellText(row.getCell(commentsCol).value) || null : null,
        });
        rows++;
        continue;
      }

      const monthCol = colOf(h, ["month"], 6)!;
      const startCol = colOf(h, ["start", "starts", "start date"], 7)!;
      const endCol = colOf(h, ["end", "ends", "due", "due date", "end date"], 8)!;
      const timeCol = colOf(h, ["time", "schedule"], 9)!;
      const dCol = colOf(h, ["d"], 10)!;
      const nsCol = colOf(h, ["ns"], 11)!;
      const oCol = colOf(h, ["o"], 12)!;
      const cCol = colOf(h, ["c"], 13)!;
      const statusCol = colOf(h, ["status"]);
      const commentsCol = colOf(h, ["comments", "notes"], 14)!;

      const month = parseMonthCell(row.getCell(monthCol).value);
      const startsOn = buildDate(year, month, row.getCell(startCol).value, "start");
      const rawEnd = buildDate(year, month, row.getCell(endCol).value, "end");
      const endsOn = startsOn && rawEnd && rawEnd < startsOn ? null : rawEnd;

      const explicitStatus = statusCol ? cellText(row.getCell(statusCol).value).toUpperCase() : "";
      const cText = cellText(row.getCell(cCol).value).toUpperCase();
      const status = isTaskStatus(explicitStatus)
        ? explicitStatus
        : isTaskStatus(cText)
          ? cText
          : statusFromMarks({
              d: cellText(row.getCell(dCol).value),
              ns: cellText(row.getCell(nsCol).value),
              o: cellText(row.getCell(oCol).value),
              c: cellText(row.getCell(cCol).value),
            });

      tasks.push({
        ...base,
        status,
        progress: status === "COMPLETE" ? 100 : null,
        startsOn,
        endsOn,
        scheduleNote: cellText(row.getCell(timeCol).value) || null,
        comments: cellText(row.getCell(commentsCol).value) || null,
      });
      rows++;
    }

    sheets.push({ name: area, shape, rows });
    if (!rows) skipped.push({ row: area, reason: "No task rows found" });
  }

  return { tasks, skipped, sheets };
}
