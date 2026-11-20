import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import ExcelJS from "exceljs";

/**
 * Reads and normalises calendar events from:
 * 1. The IICA-TT multi-sheet monthly grid workbook (`2026 Team-TT Calendar.xlsx`,
 *    with sheets such as Jan26, Feb26, …, Dec26)
 * 2. Standard tabular `.xlsx` schedules (Title / Start / End / Location / Type)
 * 3. `.csv` schedules
 * 4. `.ics` exports from Outlook, Google Calendar or Apple Calendar
 * 5. SharePoint / OneDrive workbook URLs
 */

export type ParsedEvent = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  eventType: "MEETING" | "MISSION" | "LEAVE" | "HOLIDAY" | "DEADLINE" | "OTHER";
  leadInitials?: string | null;
  /** Optional explicit reconciliation key (e.g. `timeline:<taskId>:<occ>`). */
  sourceKey?: string;
  /** Optional explicit DB user ID for organiser attribution (e.g. from staff_tasks.owner_id). */
  organiserId?: number | null;
};

export type ParseResult = {
  events: ParsedEvent[];
  skipped: { row: string; reason: string }[];
  format?: "iica-grid" | "tabular-xlsx" | "csv" | "ics";
  sheetsRead?: string[];
  /** `YYYY-MM` keys covered by parsed monthly tabs (including tabs with 0 events). */
  sheetMonths?: string[];
};

export function getDefaultSharePointCalendarUrl(): string {
  return process.env.SHAREPOINT_CALENDAR_URL?.trim() || "";
}

export const DEFAULT_SHAREPOINT_CALENDAR_URL = getDefaultSharePointCalendarUrl();

export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const TYPES = new Set(["MEETING", "MISSION", "LEAVE", "HOLIDAY", "DEADLINE", "OTHER"] as const);

const CATEGORY_LABEL_TO_TYPE: Record<string, ParsedEvent["eventType"]> = {
  MEETING: "MEETING",
  MEETINGS: "MEETING",
  MISSION: "MISSION",
  MISSIONS: "MISSION",
  "FIELD VISIT": "MISSION",
  LEAVE: "LEAVE",
  "LEAVE & VACATION": "LEAVE",
  VACATION: "LEAVE",
  HOLIDAY: "HOLIDAY",
  HOLIDAYS: "HOLIDAY",
  "PUBLIC HOLIDAY": "HOLIDAY",
  DEADLINE: "DEADLINE",
  DEADLINES: "DEADLINE",
  OTHER: "OTHER",
  GENERAL: "OTHER",
};

/**
 * Trinidad and Tobago is on Atlantic Standard Time (UTC-4) year-round with no DST.
 * Creating timestamps at UTC+4h ensures `10:00 AM` local time is stored as
 * `14:00:00Z` (`10:00:00-04`), never shifted 4 hours early.
 */
const TT_UTC_OFFSET_HOURS = 4;

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= maxDay;
}

export function makeTrinidadDate(
  year: number,
  month: number,
  day: number,
  hour = 9,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + TT_UTC_OFFSET_HOURS, minute, 0));
}

const MONTH_BANNER_RE =
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}$/i;

/** Junk/banner strings in the monthly spreadsheet that are not calendar events. */
const NON_EVENT_PATTERNS = [
  /^links?\s+to\s+act[i]?vity\s+briefs?$/i,
  /^notes?\s+for\s+bop$/i,
  /^notes?\s*\d+\s*:/i,
  /^notes?\s*:\s*cop-mop\b/i,
  /^sfc$/i,
  /^\d{3,}[a-z]{1,3}$/i,
  /^\d{1,2}\s+(or|to)\s+\d{1,2}\s+[a-z]+$/i,
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|sat|sun)$/i,
  MONTH_BANNER_RE,
  /^20\d{2}\s+team-tt\s+calendar/i,
];

export function isNonEventBanner(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /^\d{1,2}$/.test(trimmed)) return true;
  return NON_EVENT_PATTERNS.some((re) => re.test(trimmed));
}

export function classifyEventType(
  rawText: string,
  explicitType?: string | null,
): "MEETING" | "MISSION" | "LEAVE" | "HOLIDAY" | "DEADLINE" | "OTHER" {
  if (explicitType) {
    for (const part of explicitType.split(",")) {
      const upper = part.trim().toUpperCase();
      if (TYPES.has(upper as never)) return upper as ParsedEvent["eventType"];
      if (upper in CATEGORY_LABEL_TO_TYPE) return CATEGORY_LABEL_TO_TYPE[upper];
    }
  }
  const text = rawText.trim();
  const lower = text.toLowerCase();

  if (
    /\b(carnival|carvnial|divali|corpus\s+christi(?!\s+(?:college|secondary|school))|labour\s+day|emancipation(?!\s+village)|indian\s+arrival|arrival\s+day|spiritual\s+baptist|good\s+friday|easter\s+monday|christmas(?:\s+day)?|boxing\s+day|new\s+year(?:'s)?(?:\s+day)?|eid(?:\b|[\s-]+ul[\s-]+(?:fitr|adha))|republic\s+day|independence\s+day|holiday\s+observed|public\s+holiday|nat+ional\s+holiday)\b|^holiday$/i.test(
      lower,
    )
  ) {
    return "HOLIDAY";
  }

  // Check if this is primarily a meeting/workshop that merely mentions "wfh" at the end
  const isMeetingWithNote =
    /\b(mtg|meeting|session|workshop|webinar|consultation|briefing|seminar|training)\b/i.test(text) &&
    !/^(vaca|vacation|sick|med[\s-]*leave|wfh\s*[:|-]|out[\s-]+of[\s-]+office)/i.test(text);

  if (!isMeetingWithNote) {
    if (
      /^(vaca|vacation|sick|med[\s-]*leave|wfh\b)/i.test(text) ||
      /\b(vacation|vaca\b|sick\s*day|sick\s*:|med[\s-]*leave|(?:annual|maternity|paternity|casual|study|special)\s+leave|out[\s-]+of[\s-]+office|comp\s*day|comptime)\b/i.test(
        lower,
      )
    ) {
      return "LEAVE";
    }
  }

  if (
    /(?:\bdeadline\b|\bdue\s*:|\bclosing\s+accounts\b|\breport\s*prep\b|\bpayments?\s*(?:4|for)?\s*processing\b|\brequest\s+(?:of|for)\s+(?:funds|cash)\b|\bconcept\s+note\b|\bsugi\b|\bknowledge\s+products\b|\bmonthly\s+listing\b|\bbudget\s+update\b|\baccountability\b|\bsubmit(?:ted|tal)?\b|\brpt\s+submitted\b|\bcompleted\s+wfp\s+reports\b|\bdeliverables?\b|\bvat\s+returns?\b)/i.test(
      lower,
    )
  ) {
    return "DEADLINE";
  }

  if (
    /\b(training|workshop|wkshp|field\s+visit|field\s+session|field\s+simulation|mission|travel\s+mission|travel\s+to\s+[a-z]+|study\s+tour|expo\b|symposium|seminar|clinic\b|honey\s+fest|honey\s+festival|school\s+garden|land\s+prep)\b/i.test(
      lower,
    ) ||
    /\bproject\s*-\s*(?:antigua|dominica|colombia|barbados|guyana|suriname|bahamas)\b/i.test(lower)
  ) {
    return "MISSION";
  }

  if (/\b(mtg|meeting|check[\s-]*ins?|catch[\s-]*up|webinar|consultation|briefing|roundtable|agm|forum|conference)\b/i.test(lower)) {
    return "MEETING";
  }

  if (
    /^(?:tbc\s*:|tbd\s*:|appointment\b)/i.test(text) ||
    /\b(black[\s-]*out|cpe\s*course|course)\b/i.test(lower)
  ) {
    return "OTHER";
  }

  return "MEETING";
}

type ParsedTiming = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  allDay: boolean;
  cleanedText: string;
};

function isValidHm(hour: number, minute: number, allow24hEnd = false): boolean {
  const maxHour = allow24hEnd ? 24 : 23;
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= maxHour &&
    minute >= 0 &&
    minute <= 59 &&
    !(hour === 24 && minute > 0)
  );
}

function to24Hour(hour: number, meridiem: "am" | "pm"): number {
  if (meridiem === "pm" && hour < 12) return hour + 12;
  if (meridiem === "am" && hour === 12) return 0;
  return hour;
}

function inferStartMeridiem(
  startH: number,
  endH: number,
  endMeridiem: "am" | "pm",
): "am" | "pm" {
  if (endMeridiem === "am") return "am";
  // e.g. "11:30-12:00PM" -> 11:30 AM to 12:00 PM
  if (endH === 12) return startH === 12 ? "pm" : "am";
  // e.g. "8:00-4:30PM", "9:00-2:00PM", "10:00-3:00PM", "10:00-1:00PM" -> start is AM (8, 9, 10, 11)
  if (startH >= 7 && startH <= 11 && (startH > endH || endH <= 6)) {
    return "am";
  }
  // e.g. "1:00-3:00PM", "2:00-3:00PM", "3:30-4:45PM" -> start is PM
  return "pm";
}

function normalizeMer(m?: string, h?: number): "am" | "pm" | null {
  if (!m) return null;
  const low = m.toLowerCase();
  if (low === "noon") return "pm";
  if (low === "am" || low === "pm") return low;
  return h && h >= 7 && h <= 11 ? "am" : "pm";
}

function resolveHourRange(
  h1: number,
  m1: number,
  mer1Raw: string | undefined,
  h2: number,
  m2: number,
  mer2Raw: string | undefined,
): { startHour: number; startMinute: number; endHour: number; endMinute: number } | null {
  if (m1 > 59 || m2 > 59) return null;
  if (mer1Raw && (h1 < 1 || h1 > 12)) return null;
  if (mer2Raw && (h2 < 1 || h2 > 12)) return null;
  if (!mer1Raw && (h1 < 0 || h1 > 23)) return null;
  if (!mer2Raw && (h2 < 0 || h2 > 23)) return null;

  let mer2 = normalizeMer(mer2Raw, h2);
  let mer1 = normalizeMer(mer1Raw, h1);

  let startHour: number;
  let endHour: number;

  // Un-meridiemed 24-hour range such as "11:00 - 13:00" or "14:00 - 16:30"
  if (!mer1 && !mer2 && (h1 >= 13 || h2 >= 13 || h1 === 0 || h2 === 0)) {
    startHour = h1;
    endHour = h2;
  } else {
    if (!mer2) {
      if (mer1 === "am" && h2 < h1) mer2 = "pm";
      else if (mer1 === "pm") mer2 = "pm";
      else mer2 = h2 >= 7 && h2 <= 11 ? "am" : "pm";
    }
    if (!mer1) {
      mer1 = inferStartMeridiem(h1, h2, mer2);
    }
    startHour = to24Hour(h1, mer1);
    endHour = to24Hour(h2, mer2);

    // Fix office-hour AM/PM typos like "1:30 - 2:30AM", "8:30am-1:30am", "11:00 AM - 12:00 AM"
    if (startHour >= 1 && startHour <= 5 && mer1 === "am" && mer2 === "am") {
      startHour += 12;
      if (endHour >= 1 && endHour <= 6) endHour += 12;
    }
    if (startHour >= 7 && startHour <= 11 && endHour <= startHour && h2 === 12) {
      endHour = 12;
    }
    if (startHour >= 7 && startHour <= 11 && endHour < startHour && h2 >= 1 && h2 <= 6 && mer2 === "am") {
      endHour = h2 + 12;
    }
    // Evening event ending at midnight or early AM (e.g. "10:00pm - 12:00am", "11:00pm - 1:00am")
    if (startHour >= 17 && mer2 === "am" && (endHour < startHour || h2 === 12)) {
      endHour = (h2 === 12 ? 0 : endHour) + 24;
    }
  }

  if (endHour < startHour || (endHour === startHour && m2 <= m1)) {
    endHour = startHour + 1;
  }
  if (!isValidHm(startHour, m1) || !isValidHm(endHour, m2, true)) return null;
  return { startHour, startMinute: m1, endHour, endMinute: m2 };
}

/**
 * Parses both time ranges ("10:00am-12:00PM:", "10:00-3:00PM:", "9:30 - 2:30PM.",
 * "11:30-12:PM:", "7;00am-1:25pm:", "6:30PM to 7:30pm") and single times
 * ("8:45AM:", "2:00pm:", "12 noon:") from an IICA calendar cell entry.
 */
export function extractTimingFromText(raw: string): ParsedTiming {
  const text = raw
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/(\d{1,2});(\d{2})\s*(am|pm)/gi, "$1:$2$3")
    .replace(/(\d{1,2})::(\d{2})/g, "$1:$2")
    .replace(/(\d{1,2}):(\d{2}):\d{2}\s*(am|pm)/gi, "$1:$2$3")
    .replace(/(\d{1,2}):(\d)\s*(am|pm)/gi, "$1:0$2$3")
    .replace(/(\d{1,2}:\d{2})\s*m\s*-\s*(\d{1,2}:\d{2})/gi, "$1am-$2")
    .replace(/(\d{1,2}):\s*(am|pm)/gi, "$1:00$2")
    .replace(/(\d{1,2}(?::\d{2})?)\s*mpm\b/gi, "$1pm")
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*apm\b/gi, (_, t) => {
      const h = parseInt(String(t).split(":")[0], 10);
      return `${t}${h >= 7 && h <= 11 ? "am" : "pm"}`;
    })
    .trim();

  // Strip "ALL DAY:" or "All Day|" prefix
  const allDayPrefix = text.match(/^all\s+day\s*[:|\-]\s*/i);
  if (allDayPrefix) {
    return {
      startHour: 9,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
      allDay: true,
      cleanedText: text.slice(allDayPrefix[0].length).trim() || text,
    };
  }

  // Handle "8:30 AM: ALL DAY: ..." when explicitly flagged as all day without a range
  const embeddedAllDay = text.match(/^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[:|\-]\s*)all\s+day\s*[:|\-]\s*/i);
  if (embeddedAllDay) {
    return {
      startHour: 9,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
      allDay: true,
      cleanedText: text.slice(embeddedAllDay[0].length).trim() || text,
    };
  }

  // Optional prefix like "IICA EVENT " or status tags like "TBC: ", "TBD ", "PRIORITY: " before time
  const prefixMatch = text.match(/^(?:IICA\s+EVENT\s+|(?:PRIORITY|TBC|TBD)\s*:?\s+)/i);
  const rawPrefix = prefixMatch ? prefixMatch[0] : "";
  const body = rawPrefix ? text.slice(rawPrefix.length).trim() : text;
  const keepPrefix = /^IICA\s+EVENT\s+/i.test(rawPrefix)
    ? rawPrefix
    : /^(TBC|TBD)/i.test(rawPrefix)
      ? `${rawPrefix.trim().replace(/:$/, "")}: `
      : "";

  // 1. Check for a range at the start: e.g. "10:00am-12:00pm: ...", "6:30PM to 7:30pm ...", "9:00-12 noon"
  const rangeStartRe =
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)?(?:\s*\(tbc\))?\s*(?:[:.\-|]\s*|\s+)/i;
  const rangeMatch = body.match(rangeStartRe);
  if (rangeMatch) {
    const [, h1Raw, m1Raw, mer1Raw, h2Raw, m2Raw, mer2Raw] = rangeMatch;
    if (mer1Raw || mer2Raw || m1Raw !== undefined || m2Raw !== undefined) {
      const resolved = resolveHourRange(
        Number(h1Raw),
        Number(m1Raw ?? 0),
        mer1Raw,
        Number(h2Raw),
        Number(m2Raw ?? 0),
        mer2Raw,
      );
      if (resolved) {
        const cleaned = (keepPrefix + body.slice(rangeMatch[0].length)).trim();
        return {
          ...resolved,
          allDay: false,
          cleanedText: cleaned || text,
        };
      }
    }
  }

  // 2. Check for single time at the start: "10:00AM: ...", "12 noon: ...", "2:00 pm - ..."
  const singleStartRe =
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)\b(?:\s*\(tbc\))?\s*(?:[:.\-|]\s*|\s+)/i;
  const singleMatch = body.match(singleStartRe);
  if (singleMatch) {
    const [, hRaw, mRaw, merRaw] = singleMatch;
    const h = Number(hRaw);
    const m = Number(mRaw ?? 0);
    const mer: "am" | "pm" = merRaw.toLowerCase() === "am" ? "am" : "pm";
    if (h >= 1 && h <= 12 && m <= 59) {
      const startHour = to24Hour(h, mer);
      const endHour = startHour + 1;
      const cleaned = (keepPrefix + body.slice(singleMatch[0].length)).trim();
      return {
        startHour,
        startMinute: m,
        endHour,
        endMinute: m,
        allDay: false,
        cleanedText: cleaned || text,
      };
    }
  }

  // 3. Check for embedded range (with or without "Time"), requiring at least end meridiem
  const embeddedRangeRe =
    /(?:^|\btime\s+|[\s(\[-])(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)\b/i;
  const embRange = text.match(embeddedRangeRe);
  if (embRange) {
    const resolved = resolveHourRange(
      Number(embRange[1]),
      Number(embRange[2] ?? 0),
      embRange[3],
      Number(embRange[4]),
      Number(embRange[5] ?? 0),
      embRange[6],
    );
    if (resolved) {
      return {
        ...resolved,
        allDay: false,
        cleanedText: text,
      };
    }
  }

  const embeddedSingleRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)\b/i;
  const embSingle = text.match(embeddedSingleRe);
  if (embSingle) {
    const h = Number(embSingle[1]);
    const m = Number(embSingle[2] ?? 0);
    const mer: "am" | "pm" = embSingle[3].toLowerCase() === "am" ? "am" : "pm";
    if (h >= 1 && h <= 12 && m <= 59) {
      const startHour = to24Hour(h, mer);
      return {
        startHour,
        startMinute: m,
        endHour: startHour + 1,
        endMinute: m,
        allDay: false,
        cleanedText: text,
      };
    }
  }

  return {
    startHour: 9,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    allDay: true,
    cleanedText: text,
  };
}

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

const STAFF_CODE_LIST_ITEM = "(?:DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)";

function expandInitialsInStaffContext(line: string): string {
  // 1. Expand "Participants: ..." / "Lead: ..." / leave-prefixed lines cleanly
  let out = line.replace(
    /^(\s*(?:Participants|Lead|VACATION|Vacation|VACA|Vaca|SICK(?:\s*DAY)?|Sick(?:\s*Day)?|MED[\s-]*LEAVE|Med[\s-]*Leave|WFH)\s*[:|-]\s*)(.+)$/i,
    (_, prefix: string, rest: string) => {
      const expandedRest = rest.replace(
        new RegExp(`(?<![A-Za-z0-9/\\-])(${STAFF_CODE_LIST_ITEM})(?![A-Za-z0-9/\\-])`, "g"),
        (code) => STAFF_NAME_BY_CODE[code] ?? code,
      );
      return prefix + expandedRest;
    },
  );

  // 2. Expand leading staff marker like "DF: ...", "JL & SE - ...", "LH, MA:"
  out = out.replace(
    new RegExp(
      `^(${STAFF_CODE_LIST_ITEM}(?:\\s*(?:[,;/&+]|and)\\s*${STAFF_CODE_LIST_ITEM})*)(?=\\s*[:\\-,;|]|\\s+(?:BLACK|black|Travel|travel|Target|target|wfh|WFH|Appointment|to\\b|in\\b))`,
    ),
    (list) =>
      list.replace(
        new RegExp(`\\b(${STAFF_CODE_LIST_ITEM})\\b`, "g"),
        (code) => STAFF_NAME_BY_CODE[code] ?? code,
      ),
  );

  // 3. Expand multi-person staff groups ("DF & SE", "DF, LH, RR", "GEH; MA") without
  //    expanding standalone ambiguous acronyms like "MFCA and MA" or "AD-HOC".
  out = out.replace(
    new RegExp(
      `(?<![A-Za-z0-9/\\-])(${STAFF_CODE_LIST_ITEM}(?:\\s*[,;/&+]\\s*${STAFF_CODE_LIST_ITEM})+)(?![A-Za-z0-9/\\-])`,
      "g",
    ),
    (group) =>
      group.replace(
        new RegExp(`\\b(${STAFF_CODE_LIST_ITEM})\\b`, "g"),
        (code) => STAFF_NAME_BY_CODE[code] ?? code,
      ),
  );

  // 4. Expand trailing "- JL" or ": JL" at end of title
  out = out.replace(
    new RegExp(`([:\\-]\\s*)(${STAFF_CODE_LIST_ITEM})\\s*$`),
    (_, sep: string, code: string) => `${sep}${STAFF_NAME_BY_CODE[code] ?? code}`,
  );

  return out;
}

export function expandStaffInitialsInText(raw: string): string {
  const expandChunk = (segment: string) =>
    segment
      .split("\n")
      .map((line) =>
        expandInitialsInStaffContext(
          line
            .replace(/\bVACATION\b/g, "Vacation")
            .replace(/\bNattional Holiday\b/gi, "National Holiday")
            .replace(/\bOpertaions\b/gi, "Operations")
            .replace(/\bPortfilio\b/gi, "Portfolio")
            .replace(/\bInvititation\b/gi, "Invitation")
            .replace(/\bSTaff\b/g, "Staff")
            .replace(/(^|\s)-+(?=[A-Z])/g, "$1")
            .replace(/\s*,\s*$/g, "")
            .replace(/ {2,}/g, " "),
        ),
      )
      .join("\n");

  return raw
    .split(/(https?:\/\/\S+)/gi)
    .map((part, idx) => (idx % 2 === 1 ? part : expandChunk(part)))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const BRACKET_PARTICIPANT_RE = new RegExp(
  `^(?:${STAFF_CODE_LIST_ITEM}|CSM|KCM|KSM|CJ|TS|NR|AG|MB|AMG|all\\s+(?:available\\s+)?(?:staff|tt\\s+team)|full\\s+team|tech\\s+team|admin\\s+team|interested\\s+staff|staff|interns|open|\\?+)(?:[\\s,;+&/|\\-:]+(?:[A-Z]{2,4}|all\\s+(?:available\\s+)?(?:staff|tt\\s+team)|interested\\s+staff|staff|team|interns|in\\s+person|\\?+|Akio|Earllene|Moesha|tbc|[A-Z][a-z]+))*$`,
  "i",
);

/**
 * Extracts structured metadata (location, staff initials, Zoom link/notes, clean title)
 * from a calendar cell text.
 */
export function extractMetadataFromText(
  cleanedText: string,
  dayOfMonth?: number,
): {
  title: string;
  location: string | null;
  description: string | null;
  leadInitials: string | null;
} {
  let work = cleanedText.trim();

  // Strip leading day-of-month prefix like "21 Moruga Farmers' Training" when on day 21
  const leadDayMatch = work.match(/^(\d{1,2})\s+(?=[A-Za-z0-9])/);
  if (leadDayMatch && (!dayOfMonth || Number(leadDayMatch[1]) === dayOfMonth)) {
    work = work.slice(leadDayMatch[0].length).trim();
  }

  const notes: string[] = [];
  let location: string | null = null;
  let leadInitials: string | null = null;

  // Extract URLs (e.g. Zoom links + optional Passcode)
  const urlMatch = work.match(/https?:\/\/\S+(?:\s+Passcode:\s*\S+)?/i);
  if (urlMatch) {
    notes.push(urlMatch[0].trim());
    work = work.replace(urlMatch[0], "").trim();
    if (/zoom\.us|teams\.microsoft|meet\.google/i.test(urlMatch[0])) {
      location = "Zoom / Virtual";
    }
  }

  // Extract bracketed tags at the end or inline, e.g. [DF, LH, RR] or {LH & Team]
  const bracketMatches = [...work.matchAll(/[\[{(]([^\]})]{2,60})[\]})]/g)];
  const staffTokens: string[] = [];
  for (const m of bracketMatches) {
    const inside = m[1].trim();
    if (/^zoom(\s+workplace)?$/i.test(inside)) {
      location = location ?? "Zoom / Virtual";
      work = work.replace(m[0], "").trim();
      continue;
    }
    if (/namdevco|hyatt|hilton|cariri|iica-tt|conference\s+room|piarco|marac/i.test(inside)) {
      location = location ?? inside;
      work = work.replace(m[0], "").trim();
      continue;
    }
    // Check if inside looks like staff initials / team list (avoid eating prose like "(for the team)")
    if (BRACKET_PARTICIPANT_RE.test(inside)) {
      staffTokens.push(inside);
      if (!leadInitials) {
        const firstMatch = inside.match(new RegExp(`\\b(${STAFF_CODE_LIST_ITEM})\\b`, "i"));
        if (firstMatch) leadInitials = firstMatch[1].toUpperCase();
      }
      work = work.replace(m[0], "").trim();
    }
  }

  // Also check explicit leave prefixes ("VACATION: DEF") or uppercase staff prefix ("JL & SE - ", "GH: ")
  if (!leadInitials) {
    const leavePrefixMatch = work.match(
      new RegExp(
        `^(?:vaca(?:tion)?|sick(?:\\s*day)?|med[\\s-]*leave|wfh)\\s*[:|\\-]\\s*(${STAFF_CODE_LIST_ITEM})\\b`,
        "i",
      ),
    );
    if (leavePrefixMatch) {
      leadInitials = leavePrefixMatch[1].toUpperCase();
    } else {
      const upperPrefixMatch = work.match(
        new RegExp(`^(${STAFF_CODE_LIST_ITEM})(?=\\s*[:\\-,;|&]|\\s+(?:travel|black|wfh|to\\b))`),
      );
      if (upperPrefixMatch) {
        leadInitials = upperPrefixMatch[1].toUpperCase();
      }
    }
  }

  // Extract @Location patterns safely (ignore emails, never truncate title prose after @)
  const atIicaMidMatch = work.match(/(?:^|\s)@\s*(IICA(?:-TT)?)\b/i);
  const atEndMatch = work.match(/(?:^|\s)@\s*([A-Z0-9][^[\];|\n.]{1,50}?)(?=\s*$|\s+\+[A-Z]{2,3}\b)/);
  const atPrefixMatch = work.match(/^@\s*([A-Z0-9][^-\n:;|]{1,40}?)\s*-\s*(?=\S)/);

  if (atPrefixMatch) {
    const rawLoc = atPrefixMatch[1].trim();
    location = location ?? (/^iica(-tt)?$/i.test(rawLoc) ? "IICA-TT Office" : rawLoc);
    work = work.slice(atPrefixMatch[0].length).trim();
  } else if (atEndMatch && !/@/.test(atEndMatch[1]) && !/\b(?:with|to|for|led by)\b/i.test(atEndMatch[1])) {
    const rawLoc = atEndMatch[1].replace(/[.,;]+$/, "").trim();
    if (rawLoc) {
      location = location ?? (/^iica(-tt)?$/i.test(rawLoc) ? "IICA-TT Office" : rawLoc);
      const stripped = work.replace(atEndMatch[0], " ").trim();
      if (stripped) work = stripped;
    }
  } else if (atIicaMidMatch) {
    location = location ?? "IICA-TT Office";
  }

  // Infer common locations from text if still null
  if (!location) {
    if (/\b(virtual|zoom|webinar|emeeting|online\s+mtg)\b/i.test(work)) {
      location = "Zoom / Virtual";
    } else if (/\biica-tt\s+conference\s+room\b/i.test(work)) {
      location = "IICA-TT Conference Room";
    } else if (/\bhyatt(\s+regency)?\b/i.test(work)) {
      location = "Hyatt Regency";
    } else if (/\bat\s+hilton\b/i.test(work)) {
      location = "Hilton Trinidad";
    } else if (/\bchaguanas\s+borough\s+corporation\s+auditorium\b/i.test(work)) {
      location = "Chaguanas Borough Corporation Auditorium";
    } else if (/\buwi\s+field\s+station\b/i.test(work)) {
      location = "UWI Field Station";
    } else if (/\bmarac(\s+community\s+center)?\b/i.test(work)) {
      location = "Marac, Moruga";
    } else if (/\bnamdevco\s+packing\s+house\b/i.test(work)) {
      location = "NAMDEVCO Packing House, Piarco";
    } else if (/\bmacoya\b/i.test(work)) {
      location = "Macoya";
    } else if (/(?<!trinidad\s+(?:and|&)\s+)\btobago\b/i.test(work)) {
      location = "Tobago";
    }
  }

  if (staffTokens.length > 0) {
    notes.unshift(`Participants: ${staffTokens.join(", ")}`);
  }

  // Clean up trailing punctuation or leftover connectors
  work = work
    .replace(/\s+/g, " ")
    .replace(/^[:\-|]+\s*/, "")
    .replace(/\s*[:\-|,+]+$/, "")
    .trim();

  const rawTitle = (work || cleanedText.trim()).slice(0, 240);
  const rawDescription = notes.length ? notes.join("\n") : null;

  return {
    title: expandStaffInitialsInText(rawTitle).slice(0, 240),
    location,
    description: rawDescription ? expandStaffInitialsInText(rawDescription) : null,
    leadInitials,
  };
}

function stripLeadingCellDay(raw: string, day: number): string {
  const match = raw.trim().match(/^(\d{1,2})(?:\s+|\n+)/);
  if (match && Number(match[1]) === day) {
    return raw.trim().slice(match[0].length).trim();
  }
  return raw.trim();
}

const TIMED_LINE_START_RE =
  /^(?:(?:IICA\s+EVENT|PRIORITY|TBC|TBD)\s*:?\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|noon|-)/i;

const ALL_DAY_DISTINCT_START_RE = new RegExp(
  `^(?:[•*\\-–—]\\s+\\S|(?:IICA\\s+EVENT|PRIORITY|TBC|TBD|ALL\\s+DAY|VACATION|VACA|SICK(?:\\s*DAY)?|MED[\\s-]*LEAVE|WFH|HOLIDAY|DEADLINE|DUE)\\b\\s*[:|\\-]|${STAFF_CODE_LIST_ITEM}(?:\\s*(?:[,;/&+]|and)\\s*${STAFF_CODE_LIST_ITEM})*\\s*[:\\-])`,
  "i",
);

const CONTINUATION_LINE_RE =
  /^(?:https?:\/\/|Passcode:|Meeting\s+ID:|Registration\s+Link:|Link:|Venue:|Location:|Room:|Time:|Note:|Notes:|[\[{(])/i;

function splitMultiEventCell(rawText: string, day: number): string[] {
  const withoutDay = stripLeadingCellDay(rawText.replace(/\u00a0/g, " "), day);
  if (!withoutDay.includes("\n")) return [withoutDay];

  const lines = withoutDay.split(/\r?\n/);
  const timedLines = lines.filter((l) => TIMED_LINE_START_RE.test(l.trim())).length;

  // All-day multi-line cells: split cleanly on blank lines or distinct event/bullet/staff prefixes
  if (timedLines < 1) {
    const chunks: string[] = [];
    let current: string[] = [];
    let sawBlank = false;
    let currentHasTitle = false;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        sawBlank = true;
        continue;
      }

      const isContinuation = CONTINUATION_LINE_RE.test(trimmed) || /^[a-z]/.test(trimmed);
      const isDistinctPrefix = ALL_DAY_DISTINCT_START_RE.test(trimmed);
      const cleanedBullet = trimmed.replace(/^[•*]\s+/, "").trim();

      if (
        current.length > 0 &&
        currentHasTitle &&
        !isContinuation &&
        (sawBlank || isDistinctPrefix)
      ) {
        chunks.push(current.join(" "));
        current = [cleanedBullet];
        currentHasTitle = /[A-Za-z]{2,}/.test(cleanedBullet);
        sawBlank = false;
        continue;
      }

      current.push(cleanedBullet);
      if (/[A-Za-z]{2,}/.test(cleanedBullet)) currentHasTitle = true;
      sawBlank = false;
    }

    if (current.length > 0) chunks.push(current.join(" "));
    return chunks.length > 0 ? chunks : [withoutDay];
  }

  // Split only at lines starting with an explicit time (when another event already started)
  // or after a blank line following a timed event, provided the next line isn't just a URL/Passcode.
  const chunks: string[] = [];
  let current: string[] = [];
  let sawBlank = false;
  let currentHasTitle = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      sawBlank = true;
      continue;
    }
    const isUrlOrPasscode = /^(?:https?:\/\/|Passcode:|Registration\s+Link:)/i.test(trimmed);
    const isNumberedAgenda = /^\d+\s*[.\-)]\s+[A-Za-z]/.test(trimmed);
    const startsWithTime = TIMED_LINE_START_RE.test(trimmed) && !isNumberedAgenda;

    if (
      current.length > 0 &&
      !isUrlOrPasscode &&
      ((startsWithTime && timedLines >= 2) ||
        (sawBlank &&
          currentHasTitle &&
          timedLines === 1 &&
          lines.some((l, i) => i === 0 && TIMED_LINE_START_RE.test(l.trim()))))
    ) {
      chunks.push(current.join(" "));
      current = [trimmed];
      currentHasTitle = /[A-Za-z]{2,}/.test(trimmed);
      sawBlank = false;
      continue;
    }
    current.push(trimmed);
    if (/[A-Za-z]{2,}/.test(trimmed)) currentHasTitle = true;
    sawBlank = false;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks.length > 0 ? chunks : [withoutDay];
}

function extractMultiDayEnd(
  rawText: string,
  year: number,
  month: number,
  day: number,
): { endDay: number; cleaned: string } {
  // e.g. "May 11-13: 9AM-6:00 PM: ..."
  const monthRangeMatch = rawText.match(
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\s*-\s*(\d{1,2})\s*[:\-]\s*/i,
  );
  if (monthRangeMatch) {
    const d1 = Number(monthRangeMatch[1]);
    const d2 = Number(monthRangeMatch[2]);
    if (d1 === day && d2 >= d1 && isValidCalendarDate(year, month, d2)) {
      return { endDay: d2, cleaned: rawText.slice(monthRangeMatch[0].length).trim() };
    }
  }
  // e.g. "[Week 19-23] ..." or "(6-10)"
  const bracketRange = rawText.match(/^(?:\[Week\s+(\d{1,2})-(\d{1,2})\]\s*)/i);
  if (bracketRange) {
    const d1 = Number(bracketRange[1]);
    const d2 = Number(bracketRange[2]);
    if (d1 === day && d2 >= d1 && isValidCalendarDate(year, month, d2)) {
      return { endDay: d2, cleaned: rawText };
    }
  }
  return { endDay: day, cleaned: rawText };
}

export function buildParsedCalendarCell(
  rawText: string,
  year: number,
  month: number,
  day: number,
  spanEndDay?: number,
): ParsedEvent | null {
  const strippedDay = stripLeadingCellDay(rawText.replace(/\u00a0/g, " "), day);
  const cleanedRaw = strippedDay.replace(/\s+/g, " ").trim();
  if (isNonEventBanner(cleanedRaw)) return null;

  const multi = extractMultiDayEnd(cleanedRaw, year, month, day);
  const effectiveEndDay =
    spanEndDay && spanEndDay >= day && isValidCalendarDate(year, month, spanEndDay)
      ? spanEndDay
      : multi.endDay;

  const timing = extractTimingFromText(multi.cleaned);
  const meta = extractMetadataFromText(timing.cleanedText, day);
  if (isNonEventBanner(meta.title)) return null;

  const eventType = classifyEventType(multi.cleaned);
  const start = makeTrinidadDate(year, month, day, timing.startHour, timing.startMinute);
  const end = makeTrinidadDate(
    year,
    month,
    effectiveEndDay,
    timing.endHour,
    timing.endMinute,
  );

  return {
    title: meta.title,
    start,
    end: end > start ? end : new Date(start.getTime() + 3600000),
    allDay: timing.allDay,
    location: meta.location,
    description: meta.description,
    eventType,
    leadInitials: meta.leadInitials,
  };
}

function buildParsedCalendarCells(
  rawText: string,
  year: number,
  month: number,
  day: number,
  spanEndDay?: number,
): ParsedEvent[] {
  const segments = splitMultiEventCell(rawText, day);
  const results: ParsedEvent[] = [];
  for (const seg of segments) {
    const parsed = buildParsedCalendarCell(seg, year, month, day, spanEndDay);
    if (parsed) results.push(parsed);
  }
  return results;
}

/* ------------------------------------------------------------------ ICS -- */

function unfold(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

const WINDOWS_TZID_TO_IANA: Record<string, string> = {
  "sa western standard time": "America/Port_of_Spain",
  "atlantic standard time": "America/Halifax",
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/Indianapolis",
  "central standard time": "America/Chicago",
  "central america standard time": "America/Costa_Rica",
  "mountain standard time": "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "UTC",
  "utc": "UTC",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "sa pacific standard time": "America/Bogota",
  "sa eastern standard time": "America/Cayenne",
  "e. south america standard time": "America/Sao_Paulo",
  "argentina standard time": "America/Buenos_Aires",
};

function parseIcsDate(
  raw: string,
  params = "",
): { date: Date; allDay: boolean; y: number; mo: number; d: number } | null {
  const match = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, yStr, moStr, dStr, hStr, miStr, sStr, zFlag] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  if (!isValidCalendarDate(y, mo, d)) return null;

  if (!hStr) {
    return { date: makeTrinidadDate(y, mo, d, 9, 0), allDay: true, y, mo, d };
  }

  const h = Number(hStr);
  const mi = Number(miStr);
  const s = Number(sStr);
  if (h > 23 || mi > 59 || s > 59) return null;

  if (zFlag) {
    const utcDate = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    return Number.isNaN(utcDate.getTime()) ? null : { date: utcDate, allDay: false, y, mo, d };
  }

  // Respect explicit TZID when provided, mapping common Windows TZIDs to IANA
  const tzMatch = params.match(/TZID=([^;:]+)/i);
  const rawTzid = tzMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
  const mappedTzid = rawTzid ? WINDOWS_TZID_TO_IANA[rawTzid.toLowerCase()] ?? rawTzid : undefined;

  if (
    mappedTzid &&
    !/America\/(?:Port_of_Spain|Puerto_Rico|Barbados|Santo_Domingo)/i.test(mappedTzid)
  ) {
    try {
      const approx = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: mappedTzid,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(approx);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const tzRendered = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") === 24 ? 0 : get("hour"),
        get("minute"),
        get("second"),
      );
      const offsetMs = tzRendered - approx.getTime();
      const resolved = new Date(approx.getTime() - offsetMs);
      if (!Number.isNaN(resolved.getTime())) {
        return { date: resolved, allDay: false, y, mo, d };
      }
    } catch {
      // Unknown custom TZID: fall back to Trinidad AST below
    }
  }

  const ttDate = new Date(Date.UTC(y, mo - 1, d, h + TT_UTC_OFFSET_HOURS, mi, s));
  return Number.isNaN(ttDate.getTime()) ? null : { date: ttDate, allDay: false, y, mo, d };
}

function parseIcsDuration(raw: string): { ms: number; totalDays: number } | null {
  const m = raw
    .trim()
    .match(/^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/i);
  if (!m) return null;
  if (m[1] === "-") return null;
  const weeks = m[2] ? Number(m[2]) : 0;
  const days = m[3] ? Number(m[3]) : 0;
  const hours = m[4] ? Number(m[4]) : 0;
  const minutes = m[5] ? Number(m[5]) : 0;
  const seconds = m[6] ? Number(m[6]) : 0;
  const totalDays = weeks * 7 + days;
  const ms = (((totalDays * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  if (ms <= 0) return null;
  return { ms, totalDays };
}

const ICS_WEEKDAY_TO_UTC: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const MAX_RRULE_OCCURRENCES = 104;
const MAX_RRULE_ITERATIONS = 2500;

function formatAstDayKey(d: Date): string {
  return new Date(d.getTime() - TT_UTC_OFFSET_HOURS * 3600 * 1000).toISOString().slice(0, 10);
}

function makeIcsUidKey(uid: string): string {
  const cleaned = uid.trim();
  if (cleaned.length <= 120 && !/[\r\n]/.test(cleaned)) {
    return `ics:${cleaned}`;
  }
  const digest = createHash("sha256").update(cleaned).digest("hex").slice(0, 32);
  return `ics:${digest}`;
}

function expandIcsRrule(
  rruleRaw: string,
  startDate: Date,
  allDay: boolean,
): Date[] {
  const parts: Record<string, string> = {};
  for (const token of rruleRaw.split(";")) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      parts[token.slice(0, eq).trim().toUpperCase()] = token.slice(eq + 1).trim().toUpperCase();
    }
  }

  const freq = parts.FREQ;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    return [startDate];
  }

  const intervalRaw = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const interval = Number.isInteger(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 100 ? intervalRaw : 1;

  const countRaw = parts.COUNT ? Number(parts.COUNT) : null;
  const count = countRaw && Number.isInteger(countRaw) && countRaw >= 1
    ? Math.min(countRaw, MAX_RRULE_OCCURRENCES)
    : null;

  let untilMs: number | null = null;
  if (parts.UNTIL) {
    const parsedUntil = parseIcsDate(parts.UNTIL);
    if (parsedUntil) {
      untilMs = parsedUntil.allDay
        ? makeTrinidadDate(parsedUntil.y, parsedUntil.mo, parsedUntil.d, 23, 59).getTime() + 59_999
        : parsedUntil.date.getTime();
    }
  }

  const nowMs = Date.now();
  const oneYearMs = 366 * 86400 * 1000;
  const startMs = startDate.getTime();
  // Window: emit within ±1 year around today (or anchored from startDate if historical with COUNT/UNTIL)
  const emitWindowStart =
    count !== null || (untilMs !== null && untilMs < nowMs - oneYearMs)
      ? startMs
      : Math.max(startMs, nowMs - oneYearMs);
  const defaultWindowEnd = Math.max(startMs + oneYearMs, nowMs + oneYearMs);
  const emitWindowEnd = untilMs !== null ? Math.min(untilMs, defaultWindowEnd) : defaultWindowEnd;

  // Work in AST wall-clock components so Trinidad times stay consistent across months/years
  const startWall = new Date(startMs - TT_UTC_OFFSET_HOURS * 3600 * 1000);
  const startY = startWall.getUTCFullYear();
  const startMo = startWall.getUTCMonth(); // 0-based
  const startD = startWall.getUTCDate();
  const wallH = allDay ? 9 : startWall.getUTCHours();
  const wallMi = allDay ? 0 : startWall.getUTCMinutes();
  const wallS = allDay ? 0 : startWall.getUTCSeconds();

  const buildDateFromWallYmd = (y: number, mo0: number, d: number): Date => {
    return new Date(Date.UTC(y, mo0, d, wallH + TT_UTC_OFFSET_HOURS, wallMi, wallS));
  };

  const byDayTokens = parts.BYDAY
    ? parts.BYDAY.split(",")
        .map((t) => t.trim())
        .map((t) => {
          const m = t.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
          if (!m) return null;
          return { ord: m[1] ? Number(m[1]) : null, dow: ICS_WEEKDAY_TO_UTC[m[2]] };
        })
        .filter((x): x is { ord: number | null; dow: number } => x !== null)
    : [];

  const byMonthDays = parts.BYMONTHDAY
    ? parts.BYMONTHDAY.split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= -31 && n <= 31 && n !== 0)
    : [];

  const byMonths = parts.BYMONTH
    ? parts.BYMONTH.split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    : [];

  const results: Date[] = [];
  let totalGenerated = 0;
  let iterations = 0;

  const pushCandidate = (candidate: Date): "ok" | "stop" => {
    const ms = candidate.getTime();
    if (ms < startMs) return "ok";
    if (untilMs !== null && ms > untilMs) return "stop";
    if (ms > emitWindowEnd) return "stop";
    totalGenerated++;
    if (ms >= emitWindowStart) {
      results.push(candidate);
    }
    if (count !== null && totalGenerated >= count) return "stop";
    if (results.length >= MAX_RRULE_OCCURRENCES) return "stop";
    return "ok";
  };

  if (freq === "DAILY") {
    for (let step = 0; iterations < MAX_RRULE_ITERATIONS; step++, iterations++) {
      const d = buildDateFromWallYmd(startY, startMo, startD + step * interval);
      if (byDayTokens.length > 0) {
        const dow = new Date(d.getTime() - TT_UTC_OFFSET_HOURS * 3600 * 1000).getUTCDay();
        if (!byDayTokens.some((b) => b.dow === dow)) continue;
      }
      if (pushCandidate(d) === "stop") break;
    }
  } else if (freq === "WEEKLY") {
    const startDow = startWall.getUTCDay();
    const targetDows =
      byDayTokens.length > 0
        ? [...new Set(byDayTokens.map((b) => b.dow))].sort((a, b) => a - b)
        : [startDow];
    const weekAnchorDay = startD - startDow; // Sunday of start week

    for (let weekIdx = 0; iterations < MAX_RRULE_ITERATIONS; weekIdx++, iterations++) {
      let stopped = false;
      for (const dow of targetDows) {
        const candidate = buildDateFromWallYmd(startY, startMo, weekAnchorDay + weekIdx * interval * 7 + dow);
        if (pushCandidate(candidate) === "stop") {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  } else if (freq === "MONTHLY") {
    for (let monthIdx = 0; iterations < MAX_RRULE_ITERATIONS; monthIdx++, iterations++) {
      const totalMo = startMo + monthIdx * interval;
      const y = startY + Math.floor(totalMo / 12);
      const mo0 = ((totalMo % 12) + 12) % 12;
      const daysInMonth = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
      const dayCandidates: number[] = [];

      if (byDayTokens.length > 0) {
        for (const token of byDayTokens) {
          const matchingDays: number[] = [];
          for (let day = 1; day <= daysInMonth; day++) {
            if (new Date(Date.UTC(y, mo0, day)).getUTCDay() === token.dow) {
              matchingDays.push(day);
            }
          }
          if (token.ord === null) {
            dayCandidates.push(...matchingDays);
          } else if (token.ord > 0 && token.ord <= matchingDays.length) {
            dayCandidates.push(matchingDays[token.ord - 1]);
          } else if (token.ord < 0 && matchingDays.length + token.ord >= 0) {
            dayCandidates.push(matchingDays[matchingDays.length + token.ord]);
          }
        }
      } else if (byMonthDays.length > 0) {
        for (const md of byMonthDays) {
          const resolved = md > 0 ? md : daysInMonth + 1 + md;
          if (resolved >= 1 && resolved <= daysInMonth) dayCandidates.push(resolved);
        }
      } else if (startD <= daysInMonth) {
        dayCandidates.push(startD);
      }

      const sortedDays = [...new Set(dayCandidates)].sort((a, b) => a - b);
      let stopped = false;
      for (const day of sortedDays) {
        const candidate = buildDateFromWallYmd(y, mo0, day);
        if (pushCandidate(candidate) === "stop") {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      // Stop if the month itself is past emitWindowEnd
      if (buildDateFromWallYmd(y, mo0, 1).getTime() > emitWindowEnd) break;
    }
  } else if (freq === "YEARLY") {
    const targetMonths = byMonths.length > 0 ? byMonths.map((m) => m - 1) : [startMo];
    for (let yearIdx = 0; iterations < MAX_RRULE_ITERATIONS; yearIdx++, iterations++) {
      const y = startY + yearIdx * interval;
      let stopped = false;
      for (const mo0 of targetMonths) {
        const daysInMonth = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
        const dayList =
          byMonthDays.length > 0
            ? byMonthDays
                .map((md) => (md > 0 ? md : daysInMonth + 1 + md))
                .filter((d) => d >= 1 && d <= daysInMonth)
            : startD <= daysInMonth
              ? [startD]
              : [];
        for (const day of [...new Set(dayList)].sort((a, b) => a - b)) {
          const candidate = buildDateFromWallYmd(y, mo0, day);
          if (pushCandidate(candidate) === "stop") {
            stopped = true;
            break;
          }
        }
        if (stopped) break;
      }
      if (stopped) break;
      if (buildDateFromWallYmd(y, 0, 1).getTime() > emitWindowEnd) break;
    }
  }

  return results.length > 0 ? results : [startDate];
}

function parseIcs(source: string): ParseResult {
  const events: ParsedEvent[] = [];
  const skipped: ParseResult["skipped"] = [];
  const blocks = unfold(source).split(/BEGIN:VEVENT/i).slice(1);

  type RawIcsEvent = {
    index: number;
    block: string;
    uid: string | null;
    status: string;
    recurrenceId: { date: Date; allDay: boolean; y: number; mo: number; d: number } | null;
    readProp: (key: string) => { value: string; params: string } | undefined;
    readAllProps: (key: string) => { value: string; params: string }[];
  };

  const parsedBlocks: RawIcsEvent[] = blocks.map((rawBlock, index) => {
    const endIdx = rawBlock.search(/\nEND:VEVENT\b/i);
    const eventOnly = endIdx >= 0 ? rawBlock.slice(0, endIdx) : rawBlock;
    const block = eventOnly.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/gi, "");

    const readProp = (key: string): { value: string; params: string } | undefined => {
      const m = block.match(new RegExp(`(?:^|\\n)${key}(;[^:\\n]*)?:([^\\n\\r]*)`, "i"));
      if (!m) return undefined;
      return { params: m[1] ?? "", value: m[2]?.trim() ?? "" };
    };

    const readAllProps = (key: string): { value: string; params: string }[] => {
      const out: { value: string; params: string }[] = [];
      const re = new RegExp(`(?:^|\\n)${key}(;[^:\\n]*)?:([^\\n\\r]*)`, "gi");
      for (const m of block.matchAll(re)) {
        out.push({ params: m[1] ?? "", value: m[2]?.trim() ?? "" });
      }
      return out;
    };

    const uid = readProp("UID")?.value || null;
    const status = (readProp("STATUS")?.value || "").toUpperCase();
    const recProp = readProp("RECURRENCE-ID");
    const recurrenceId = recProp?.value ? parseIcsDate(recProp.value, recProp.params) : null;

    return { index, block, uid, status, recurrenceId, readProp, readAllProps };
  });

  // Track RECURRENCE-ID overrides (including cancelled single occurrences) so master RRULE skips them
  const overriddenByUid = new Map<string, Set<string>>();
  for (const item of parsedBlocks) {
    if (item.uid && item.recurrenceId) {
      const set = overriddenByUid.get(item.uid) ?? new Set<string>();
      set.add(formatAstDayKey(item.recurrenceId.date));
      set.add(String(item.recurrenceId.date.getTime()));
      overriddenByUid.set(item.uid, set);
    }
  }

  for (const item of parsedBlocks) {
    const { index, uid, status, recurrenceId, readProp, readAllProps } = item;
    const rawTitle = readProp("SUMMARY")?.value;
    const startProp = readProp("DTSTART");
    const label = rawTitle ? unescapeText(rawTitle) : `event ${index + 1}`;

    if (status === "CANCELLED") {
      skipped.push({ row: label, reason: "Cancelled event" });
      continue;
    }

    if (!rawTitle) {
      skipped.push({ row: `event ${index + 1}`, reason: "No SUMMARY" });
      continue;
    }
    if (!startProp?.value) {
      skipped.push({ row: label, reason: "No DTSTART" });
      continue;
    }

    const parsedStart = parseIcsDate(startProp.value, startProp.params);
    if (!parsedStart) {
      skipped.push({ row: label, reason: `Unreadable date "${startProp.value}"` });
      continue;
    }

    const endProp = readProp("DTEND");
    const parsedEnd = endProp?.value ? parseIcsDate(endProp.value, endProp.params) : null;
    const durationProp = readProp("DURATION");
    const parsedDuration = !parsedEnd && durationProp?.value ? parseIcsDuration(durationProp.value) : null;
    const allDay = parsedStart.allDay;

    let end: Date;
    if (allDay) {
      if (parsedEnd?.allDay) {
        // RFC 5545 DTEND for VALUE=DATE is exclusive: subtract 1 day for inclusive AST end
        const exclusiveDate = new Date(Date.UTC(parsedEnd.y, parsedEnd.mo - 1, parsedEnd.d - 1));
        const inclusiveEnd = makeTrinidadDate(
          exclusiveDate.getUTCFullYear(),
          exclusiveDate.getUTCMonth() + 1,
          exclusiveDate.getUTCDate(),
          17,
          0,
        );
        end =
          inclusiveEnd > parsedStart.date
            ? inclusiveEnd
            : makeTrinidadDate(parsedStart.y, parsedStart.mo, parsedStart.d, 17, 0);
      } else if (parsedDuration && parsedDuration.totalDays >= 1) {
        const endDateObj = new Date(
          Date.UTC(parsedStart.y, parsedStart.mo - 1, parsedStart.d + parsedDuration.totalDays - 1),
        );
        end = makeTrinidadDate(
          endDateObj.getUTCFullYear(),
          endDateObj.getUTCMonth() + 1,
          endDateObj.getUTCDate(),
          17,
          0,
        );
      } else {
        end = makeTrinidadDate(parsedStart.y, parsedStart.mo, parsedStart.d, 17, 0);
      }
    } else {
      if (parsedEnd && parsedEnd.date > parsedStart.date) {
        end = parsedEnd.date;
      } else if (parsedDuration) {
        end = new Date(parsedStart.date.getTime() + parsedDuration.ms);
      } else {
        end = new Date(parsedStart.date.getTime() + 3600000);
      }
    }

    const durationMs = Math.max(60_000, end.getTime() - parsedStart.date.getTime());

    // Collect EXDATE exclusions
    const excludedDayKeys = new Set<string>();
    const excludedTimestamps = new Set<number>();
    for (const exProp of readAllProps("EXDATE")) {
      for (const part of exProp.value.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const parsedEx = parseIcsDate(trimmed, exProp.params);
        if (parsedEx) {
          excludedTimestamps.add(parsedEx.date.getTime());
          if (parsedEx.allDay || allDay) {
            excludedDayKeys.add(formatAstDayKey(parsedEx.date));
          }
        }
      }
    }

    const unescapedTitle = unescapeText(rawTitle);
    const meta = extractMetadataFromText(unescapedTitle);
    const rawLocation = readProp("LOCATION")?.value;
    const rawDesc = readProp("DESCRIPTION")?.value;
    const rawCats = readProp("CATEGORIES")?.value;
    const location = rawLocation ? unescapeText(rawLocation) : meta.location;
    const description = rawDesc ? unescapeText(rawDesc) : meta.description;
    const eventType = classifyEventType(unescapedTitle, rawCats ? unescapeText(rawCats) : undefined);

    const rruleProp = !recurrenceId ? readProp("RRULE") : undefined;
    const occurrenceStarts = rruleProp?.value
      ? expandIcsRrule(rruleProp.value, parsedStart.date, allDay)
      : [parsedStart.date];

    const uidKey = uid ? makeIcsUidKey(uid) : null;
    const isRecurringSeries = Boolean(rruleProp?.value) || Boolean(recurrenceId);
    const uidOverrides = uid && !recurrenceId ? overriddenByUid.get(uid) : undefined;

    for (const occStart of occurrenceStarts) {
      const occMs = occStart.getTime();
      const occDayKey = formatAstDayKey(occStart);

      if (excludedTimestamps.has(occMs) || (allDay && excludedDayKeys.has(occDayKey))) {
        continue;
      }
      if (uidOverrides && (uidOverrides.has(String(occMs)) || uidOverrides.has(occDayKey))) {
        continue;
      }

      const occEnd = new Date(occMs + durationMs);
      let sourceKey: string | undefined;
      if (uidKey) {
        if (recurrenceId) {
          const ridTag = recurrenceId.allDay
            ? formatAstDayKey(recurrenceId.date)
            : recurrenceId.date.toISOString().slice(0, 16);
          sourceKey = `${uidKey}#${ridTag}`;
        } else if (isRecurringSeries) {
          const occTag = allDay ? occDayKey : occStart.toISOString().slice(0, 16);
          sourceKey = `${uidKey}#${occTag}`;
        } else {
          sourceKey = uidKey;
        }
      }

      events.push({
        title: meta.title || unescapedTitle,
        start: occStart,
        end: occEnd,
        allDay,
        location,
        description,
        eventType,
        leadInitials: meta.leadInitials,
        sourceKey,
      });
    }
  }

  return { events, skipped, format: "ics" };
}

/* ------------------------------------------------- shared column mapping -- */

const HEADERS: Record<string, string[]> = {
  title: ["title", "summary", "subject", "event", "activity", "description of activity"],
  start: ["starts", "start", "start date", "date", "from", "starts at"],
  end: ["ends", "end", "end date", "to", "ends at"],
  location: ["location", "room", "venue", "place"],
  description: ["description", "notes", "note", "detail", "details"],
  type: ["type", "category", "event type"],
  allDay: ["all day", "all-day", "allday"],
};

function fieldFor(header: string): string | undefined {
  const label = header.toLowerCase().replace(/\s+/g, " ").trim();
  return Object.entries(HEADERS).find(([, names]) => names.includes(label))?.[0];
}

function excelSerialToUtcDate(serial: number, date1904: boolean): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null;
  if (date1904) {
    const ms = Math.round(serial * 86400 * 1000);
    return new Date(Date.UTC(1904, 0, 1) + ms);
  }
  // Adjust for Excel's 1900 leap-year bug (serial 60 = fictitious 1900-02-29)
  const adjusted = serial > 59 ? serial - 1 : serial;
  const ms = Math.round((adjusted - 1) * 86400 * 1000);
  return new Date(Date.UTC(1900, 0, 1) + ms);
}

type StructuredCellDate = {
  date: Date;
  dateOnly: boolean;
  y: number;
  m: number;
  d: number;
};

function parseStructuredDateInput(
  rawValue: unknown,
  date1904 = false,
): StructuredCellDate | null {
  let resolved = rawValue;
  if (resolved && typeof resolved === "object" && !(resolved instanceof Date)) {
    const obj = resolved as Record<string, unknown>;
    if (obj.result !== undefined) resolved = obj.result;
    else if (obj.text !== undefined) resolved = obj.text;
  }

  if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) {
    const y = resolved.getUTCFullYear();
    const m = resolved.getUTCMonth() + 1;
    const d = resolved.getUTCDate();
    const h = resolved.getUTCHours();
    const mi = resolved.getUTCMinutes();
    const s = resolved.getUTCSeconds();
    const dateOnly = h === 0 && mi === 0 && s === 0;
    return {
      date: dateOnly ? makeTrinidadDate(y, m, d, 9, 0) : makeTrinidadDate(y, m, d, h, mi),
      dateOnly,
      y,
      m,
      d,
    };
  }

  if (typeof resolved === "number") {
    const dt = excelSerialToUtcDate(resolved, date1904);
    if (!dt) return null;
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const h = dt.getUTCHours();
    const mi = dt.getUTCMinutes();
    const dateOnly = Math.abs(resolved - Math.floor(resolved)) < 1e-6;
    return {
      date: dateOnly ? makeTrinidadDate(y, m, d, 9, 0) : makeTrinidadDate(y, m, d, h, mi),
      dateOnly,
      y,
      m,
      d,
    };
  }

  const text = cellText(resolved);
  if (!text) return null;

  // Reject bare numeric strings like "46127" unless valid Excel serials
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const num = Number(text);
    const dt = excelSerialToUtcDate(num, date1904);
    if (!dt) return null;
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const h = dt.getUTCHours();
    const mi = dt.getUTCMinutes();
    const dateOnly = Math.abs(num - Math.floor(num)) < 1e-6;
    return {
      date: dateOnly ? makeTrinidadDate(y, m, d, 9, 0) : makeTrinidadDate(y, m, d, h, mi),
      dateOnly,
      y,
      m,
      d,
    };
  }

  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (!isValidCalendarDate(y, m, d)) return null;
    return { date: makeTrinidadDate(y, m, d, 9, 0), dateOnly: true, y, m, d };
  }

  const localIso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localIso) {
    const y = Number(localIso[1]);
    const m = Number(localIso[2]);
    const d = Number(localIso[3]);
    const h = Number(localIso[4]);
    const mi = Number(localIso[5]);
    if (!isValidCalendarDate(y, m, d) || h > 23 || mi > 59) return null;
    return { date: makeTrinidadDate(y, m, d, h, mi), dateOnly: false, y, m, d };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const dateOnly = !/\d:\d/.test(text);
  if (dateOnly) {
    // Non-ISO date-only strings like "May 1, 2026" parse at local midnight in JS
    const isIsoLike = /^\d{4}-\d{1,2}-\d{1,2}/.test(text);
    const y = isIsoLike ? parsed.getUTCFullYear() : parsed.getFullYear();
    const m = (isIsoLike ? parsed.getUTCMonth() : parsed.getMonth()) + 1;
    const d = isIsoLike ? parsed.getUTCDate() : parsed.getDate();
    return { date: makeTrinidadDate(y, m, d, 9, 0), dateOnly: true, y, m, d };
  }
  const shifted = new Date(parsed.getTime() - TT_UTC_OFFSET_HOURS * 3600 * 1000);
  return {
    date: parsed,
    dateOnly: false,
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

function buildEvent(
  values: Record<string, string>,
  label: string,
  rawDates?: { start?: unknown; end?: unknown; date1904?: boolean },
): ParsedEvent | { reason: string } {
  void label;
  const title = values.title?.trim();
  if (!title) return { reason: "No title" };

  const startInput = rawDates?.start ?? values.start?.trim();
  if (!startInput && startInput !== 0) return { reason: "No start date" };
  const parsedStart = parseStructuredDateInput(startInput, Boolean(rawDates?.date1904));
  if (!parsedStart) return { reason: `Unreadable date "${values.start?.trim() ?? ""}"` };

  const allDayCell = values.allDay?.trim().toLowerCase();
  const allDay = allDayCell
    ? ["yes", "true", "y", "1", "all day"].includes(allDayCell)
    : parsedStart.dateOnly;

  const endInput = rawDates?.end ?? values.end?.trim();
  const parsedEnd =
    endInput !== undefined && endInput !== null && endInput !== ""
      ? parseStructuredDateInput(endInput, Boolean(rawDates?.date1904))
      : null;

  let start = parsedStart.date;
  let end: Date;

  if (allDay) {
    start = makeTrinidadDate(parsedStart.y, parsedStart.m, parsedStart.d, 9, 0);
    if (parsedEnd) {
      const endCandidate = makeTrinidadDate(parsedEnd.y, parsedEnd.m, parsedEnd.d, 17, 0);
      end =
        endCandidate >= start
          ? endCandidate
          : makeTrinidadDate(parsedStart.y, parsedStart.m, parsedStart.d, 17, 0);
    } else {
      end = makeTrinidadDate(parsedStart.y, parsedStart.m, parsedStart.d, 17, 0);
    }
  } else {
    end =
      parsedEnd && parsedEnd.date > start
        ? parsedEnd.date
        : new Date(start.getTime() + 3600000);
  }

  const meta = extractMetadataFromText(title);
  return {
    title: meta.title,
    start,
    end,
    allDay,
    location: values.location?.trim() || meta.location,
    description: values.description?.trim() || meta.description,
    eventType: classifyEventType(title, values.type),
    leadInitials: meta.leadInitials,
  };
}

/* ------------------------------------------------------------------ CSV -- */

function parseCsvRows(source: string): string[][] {
  const clean = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

function parseCsv(source: string): ParseResult {
  const rows = parseCsvRows(source);
  if (!rows.length) return { events: [], skipped: [], format: "csv" };

  const header = rows.shift()!;
  const mapping = header.map(fieldFor);
  if (!mapping.includes("title") || !mapping.includes("start")) {
    throw new Error("The CSV needs a Title column and a Start column.");
  }

  const events: ParsedEvent[] = [];
  const skipped: ParseResult["skipped"] = [];
  rows.forEach((cells, index) => {
    const values: Record<string, string> = {};
    mapping.forEach((field, col) => {
      if (field) values[field] = cells[col] ?? "";
    });
    const built = buildEvent(values, `row ${index + 2}`);
    if ("reason" in built) skipped.push({ row: `row ${index + 2}`, reason: built.reason });
    else events.push(built);
  });
  return { events, skipped, format: "csv" };
}

/* ----------------------------------------------------------------- XLSX -- */

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
    }
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return "";
}

const SHEET_MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseSheetMonthYear(
  sheet: ExcelJS.Worksheet,
  fallbackYear?: number,
): { month: number; year: number } | null {
  const cleaned = sheet.name.trim();
  const match = cleaned.match(/^([A-Za-z]+)[\s_'\-]*(20\d{2}|\d{2})?$/);
  if (!match) return null;
  const month = SHEET_MONTH_MAP[match[1].toLowerCase()];
  if (!month) return null;

  const rawYear = match[2];
  if (rawYear) {
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    return { month, year };
  }

  // Inspect rows 1..3 on the sheet for an explicit year banner (e.g. "JANUARY 2026")
  for (let r = 1; r <= Math.min(3, sheet.rowCount); r++) {
    for (let c = 1; c <= Math.min(14, sheet.columnCount); c++) {
      const txt = cellText(sheet.getCell(r, c).value);
      const ym = txt.match(/\b(20\d{2})\b/);
      if (ym) return { month, year: Number(ym[1]) };
    }
  }

  const currentTrinidadYear = new Date(Date.now() - TT_UTC_OFFSET_HOURS * 3600 * 1000).getUTCFullYear();
  return { month, year: fallbackYear ?? currentTrinidadYear };
}

const WEEKDAY_INDEX: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

function mapWorksheetWeekdayColumns(sheet: ExcelJS.Worksheet): {
  headerRow: number;
  colWeekday: Map<number, number>;
  primaryCols: Set<number>;
} {
  let headerRow = 0;
  const colWeekday = new Map<number, number>();
  const primaryCols = new Set<number>();

  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    let matches = 0;
    const candidate = new Map<number, number>();
    for (let c = 1; c <= sheet.columnCount; c++) {
      const txt = cellText(sheet.getCell(r, c).value).toLowerCase();
      if (txt in WEEKDAY_INDEX) {
        candidate.set(c, WEEKDAY_INDEX[txt]);
        matches++;
      }
    }
    if (matches >= 4) {
      headerRow = r;
      for (const [c, w] of candidate) colWeekday.set(c, w);
      break;
    }
  }

  if (headerRow) {
    // Handle Sept26 where C1..C2 are blank above Tuesday C3 (Monday columns)
    const cols = [...colWeekday.keys()].sort((a, b) => a - b);
    const firstCol = cols[0];
    if (firstCol && colWeekday.get(firstCol) === 1 && firstCol >= 2) {
      for (let c = 1; c < firstCol; c++) colWeekday.set(c, 0);
    }
    // Handle Jul26 where C13 immediately after Sun C12 holds Sunday overflow events
    const lastCol = cols[cols.length - 1];
    if (lastCol && colWeekday.get(lastCol) === 6 && sheet.columnCount > lastCol) {
      colWeekday.set(lastCol + 1, 6);
    }
  }

  // Track the first (left-most) column for each weekday (the day-number column in paired grids)
  const seenW = new Set<number>();
  for (const [col, w] of [...colWeekday.entries()].sort((a, b) => a[0] - b[0])) {
    if (!seenW.has(w)) {
      seenW.add(w);
      primaryCols.add(col);
    }
  }

  return { headerRow, colWeekday, primaryCols };
}

function isLeaveStripRow(rowCells: { col: number; text: string }[]): boolean {
  if (rowCells.length === 0) return false;
  return rowCells.every((c) => {
    if (isNonEventBanner(c.text)) return true;
    return /\b(vaca(?:tion)?|sick(?:\s*day)?|med[\s-]*leave|wfh|out[\s-]+of[\s-]+office|comp[\s-]*time|comp\s*day)\b/i.test(
      c.text,
    );
  });
}

function colLettersToNum(letters: string): number {
  let num = 0;
  for (const ch of letters.toUpperCase()) {
    num = num * 26 + (ch.charCodeAt(0) - 64);
  }
  return num;
}

function parseMergeBounds(sheet: ExcelJS.Worksheet): Map<string, { r1: number; c1: number; r2: number; c2: number }> {
  const map = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
  const merges = (sheet.model as { merges?: string[] })?.merges ?? [];
  for (const range of merges) {
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!m) continue;
    const c1 = colLettersToNum(m[1]);
    const r1 = Number(m[2]);
    const c2 = colLettersToNum(m[3]);
    const r2 = Number(m[4]);
    const masterKey = `${r1}:${c1}`;
    map.set(masterKey, { r1, c1, r2, c2 });
  }
  return map;
}

/**
 * Parses the IICA-TT monthly grid workbook (`2026 Team-TT Calendar.xlsx`) where
 * each worksheet is a month (`Jan26`, `Feb26`, ..., `Dec26`) laid out as a
 * visual calendar grid of weekday columns, day numbers, and activity rows.
 */
function parseMonthlyGridWorkbook(workbook: ExcelJS.Workbook): ParseResult | null {
  // First find consensus explicit year across named tabs (e.g. Jan26 -> 2026)
  const explicitYears = workbook.worksheets
    .map((s) => s.name.trim().match(/^[A-Za-z]+[\s_'\-]*(20\d{2}|\d{2})$/)?.[1])
    .filter((y): y is string => Boolean(y))
    .map((y) => (y.length === 2 ? 2000 + Number(y) : Number(y)));
  const consensusYear = explicitYears[0];

  const monthlySheets = workbook.worksheets
    .map((sheet) => ({ sheet, period: parseSheetMonthYear(sheet, consensusYear) }))
    .filter((item): item is { sheet: ExcelJS.Worksheet; period: { month: number; year: number } } =>
      Boolean(item.period),
    );

  if (monthlySheets.length === 0) return null;

  const deduped = new Map<string, ParsedEvent>();
  const skipped: ParseResult["skipped"] = [];
  const sheetsRead: string[] = [];
  const sheetMonths: string[] = [];

  for (const { sheet, period } of monthlySheets) {
    sheetsRead.push(sheet.name);
    sheetMonths.push(`${period.year}-${String(period.month).padStart(2, "0")}`);
    const { headerRow, colWeekday, primaryCols } = mapWorksheetWeekdayColumns(sheet);
    const maxDaysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
    const mergeBounds = parseMergeBounds(sheet);

    const weekdayOf = (col: number): number | undefined =>
      colWeekday.get(col) ?? (colWeekday.size === 0 ? Math.min(6, Math.floor((col - 1) / 2)) : undefined);

    type RowSnapshot = {
      row: number;
      cells: { col: number; text: string; isSlaveMerge: boolean; masterBounds?: { r1: number; c1: number; r2: number; c2: number } }[];
      anchors: Map<number, number>;
      weekDays: Map<number, number> | null;
    };

    const snapshots: RowSnapshot[] = [];
    for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
      const cells: RowSnapshot["cells"] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = sheet.getCell(row, col);
        const text = cellText(cell.value);
        if (!text) continue;
        const isSlaveMerge = Boolean(cell.isMerged && cell.master && cell.master.address !== cell.address);
        const masterBounds =
          cell.isMerged && !isSlaveMerge ? mergeBounds.get(`${row}:${col}`) : undefined;
        cells.push({ col, text, isSlaveMerge, masterBounds });
      }

      if (cells.length === 0) {
        snapshots.push({ row, cells, anchors: new Map(), weekDays: null });
        continue;
      }

      // Collect weekday-verified anchors on this row
      const anchors = new Map<number, number>();
      const primaryAnchors = new Set<number>();
      for (const { col, text } of cells) {
        const w = weekdayOf(col);
        if (w === undefined) continue;

        let candidateDay: number | null = null;
        if (/^\d{1,2}$/.test(text)) {
          candidateDay = Number(text);
        } else if (!isNonEventBanner(text)) {
          const leadDay = text.match(/^(\d{1,2})\s+(?=[A-Za-z0-9])/);
          if (leadDay) candidateDay = Number(leadDay[1]);
        }

        if (candidateDay !== null && candidateDay >= 1 && candidateDay <= maxDaysInMonth) {
          const actualW = (new Date(Date.UTC(period.year, period.month - 1, candidateDay)).getUTCDay() + 6) % 7;
          if (actualW === w) {
            const isPrimary = primaryCols.size === 0 || primaryCols.has(col);
            if (isPrimary || !primaryAnchors.has(w)) {
              anchors.set(w, candidateDay);
              if (isPrimary) primaryAnchors.add(w);
            }
          }
        }
      }

      let weekDays: Map<number, number> | null = null;
      if (anchors.size > 0) {
        const [[anchorW, anchorDay]] = [...anchors.entries()];
        const nextWeek = new Map<number, number>();
        for (let w = 0; w <= 6; w++) {
          const d = anchorDay + (w - anchorW);
          if (d >= 1 && d <= maxDaysInMonth) nextWeek.set(w, d);
        }
        for (const [w, d] of anchors) nextWeek.set(w, d);
        weekDays = nextWeek;
      }

      snapshots.push({ row, cells, anchors, weekDays });
    }

    // Resolve weekDays for every row: pre-anchor rows (e.g. Jul26 R3) and unseparated
    // leave-strip header rows (e.g. Feb26 R17, June26 R12/R16) bind to the upcoming week.
    let activeWeek: Map<number, number> | null = null;
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (snap.cells.length === 0) {
        activeWeek = null;
        continue;
      }
      if (
        snap.cells.some((c) =>
          /^(?:notes?\s+for\s+bop|links?\s+to\s+act[i]?vity\s+briefs?)$/i.test(c.text),
        )
      ) {
        activeWeek = null;
        continue;
      }
      if (snap.weekDays) {
        activeWeek = snap.weekDays;
        continue;
      }

      // Look ahead to the next anchored week before any blank row
      let upcomingWeek: Map<number, number> | null = null;
      for (let j = i + 1; j < snapshots.length; j++) {
        if (snapshots[j].cells.length === 0) break;
        if (snapshots[j].weekDays) {
          upcomingWeek = snapshots[j].weekDays;
          break;
        }
      }

      if (!activeWeek) {
        snap.weekDays = upcomingWeek;
        if (upcomingWeek) activeWeek = upcomingWeek;
      } else if (upcomingWeek && isLeaveStripRow(snap.cells)) {
        snap.weekDays = upcomingWeek;
      } else {
        snap.weekDays = activeWeek;
      }
    }

    // Extract events using resolved weekDays
    for (const snap of snapshots) {
      if (!snap.weekDays || snap.weekDays.size === 0) continue;

      for (const { col, text: raw, isSlaveMerge, masterBounds } of snap.cells) {
        if (isSlaveMerge) continue;
        if (isNonEventBanner(raw)) continue;
        const w = weekdayOf(col);
        if (w === undefined) continue;
        const day = snap.weekDays.get(w);
        if (!day || day < 1 || day > maxDaysInMonth) continue;

        // If cell is horizontally merged across multiple days in this week, span start..end day
        let spanEndDay = day;
        if (masterBounds && masterBounds.c2 > masterBounds.c1) {
          for (let mc = masterBounds.c1; mc <= masterBounds.c2; mc++) {
            const mw = weekdayOf(mc);
            if (mw !== undefined) {
              const md = snap.weekDays.get(mw);
              if (md && md > spanEndDay) spanEndDay = md;
            }
          }
        }

        const parsedList = buildParsedCalendarCells(raw, period.year, period.month, day, spanEndDay);
        for (const parsed of parsedList) {
          const timeKey = parsed.allDay ? "ALLDAY" : parsed.start.toISOString();
          const key = `${period.year}-${period.month}-${day}|${timeKey}|${parsed.title.toLowerCase()}`;
          if (!deduped.has(key)) {
            deduped.set(key, parsed);
          }
        }
      }
    }
  }

  return {
    events: [...deduped.values()],
    skipped,
    format: "iica-grid",
    sheetsRead,
    sheetMonths,
  };
}

export async function parseXlsxBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const date1904 = Boolean((workbook.properties as { date1904?: boolean } | undefined)?.date1904);

  // Check if workbook contains IICA monthly grid tabs (Jan26..Dec26)
  const gridResult = parseMonthlyGridWorkbook(workbook);

  // Extract tabular sheets (sheets with explicit Title + Start columns, excluding monthly grid sheets)
  const gridSheetNames = new Set(gridResult?.sheetsRead ?? []);
  const events: ParsedEvent[] = [];
  const skipped: ParseResult["skipped"] = [];
  const sheetsRead: string[] = [];
  let sawHeader = false;

  for (const sheet of workbook.worksheets) {
    if (gridSheetNames.has(sheet.name)) continue;

    let headerRow = 0;
    let mapping: Record<number, string> = {};
    for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
      const candidate: Record<number, string> = {};
      sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const field = fieldFor(cellText(cell.value));
        if (field && !Object.values(candidate).includes(field)) {
          candidate[col] = field;
        }
      });
      const fields = Object.values(candidate);
      if (fields.includes("title") && fields.includes("start")) {
        headerRow = r;
        mapping = candidate;
        break;
      }
    }
    if (!headerRow) continue;
    sawHeader = true;
    sheetsRead.push(sheet.name);

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const values: Record<string, string> = {};
      const rawDates: { start?: unknown; end?: unknown; date1904: boolean } = { date1904 };
      sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const field = mapping[col];
        if (!field) return;
        values[field] = cellText(cell.value);
        if (field === "start") rawDates.start = cell.value;
        if (field === "end") rawDates.end = cell.value;
      });
      if (!Object.values(values).some((v) => v !== "")) continue;
      const label = `${sheet.name} row ${r}`;
      const built = buildEvent(values, label, rawDates);
      if ("reason" in built) skipped.push({ row: label, reason: built.reason });
      else events.push(built);
    }
  }

  // Prefer IICA monthly grid when present (ignoring ancillary summary/reference tabs)
  if (gridResult) {
    return gridResult;
  }

  if (sawHeader) {
    return { events, skipped, format: "tabular-xlsx", sheetsRead };
  }

  throw new Error(
    "Could not recognise workbook layout. Provide either a monthly calendar workbook (Jan26–Dec26) or a sheet with Title and Start columns.",
  );
}

/* --------------------------------------------------- SharePoint URL sync -- */

export function hashBuffer(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

/**
 * Encodes any SharePoint or OneDrive sharing link into a Microsoft Graph
 * `u!...` shareId token per Microsoft Graph `/shares/{shareId}/driveItem/content` spec.
 */
export function encodeGraphSharingToken(shareUrl: string): string {
  const base64 = Buffer.from(shareUrl.trim(), "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `u!${base64}`;
}

const SHAREPOINT_INITIAL_HOST_RE =
  /(?:^|\.)(?:sharepoint\.com|sharepoint-df\.com|onedrive\.live\.com|1drv\.com)$/i;
const SHAREPOINT_REDIRECT_HOST_RE =
  /(?:^|\.)(?:sharepoint\.com|sharepoint-df\.com|sharepointonline\.com|onedrive\.live\.com|1drv\.com|1drv\.ms|microsoftonline\.com|microsoft\.com|msftauth\.net|live\.com|livefilestore\.com|svc\.ms|windows\.net)$/i;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.split("%")[0].toLowerCase();
  const ver = net.isIP(ip);
  if (ver === 4) return isPrivateOrReservedIpv4(ip);
  if (ver !== 6) return true;

  if (ip === "::" || ip === "::1") return true;
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateOrReservedIpv4(v4Mapped[1]);
  const v4Hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1], 16);
    const lo = parseInt(v4Hex[2], 16);
    return isPrivateOrReservedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
  if (ip.startsWith("ff")) return true; // multicast
  if (ip.startsWith("100::") || ip.startsWith("2001:db8:")) return true;
  return false;
}

export async function validateSharePointUrl(
  rawUrl: string,
  allowRedirectHosts = false,
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid SharePoint or OneDrive workbook URL.");
  }

  if (u.protocol !== "https:") {
    throw new Error("SharePoint URL must use https://.");
  }
  if (u.username || u.password) {
    throw new Error("SharePoint URL cannot contain embedded credentials.");
  }

  const host = u.hostname.toLowerCase();
  const hostAllowed = allowRedirectHosts
    ? SHAREPOINT_REDIRECT_HOST_RE.test(host)
    : host === "1drv.ms" || SHAREPOINT_INITIAL_HOST_RE.test(host);

  if (!hostAllowed) {
    throw new Error("URL must point to an official SharePoint or OneDrive host (*.sharepoint.com, 1drv.ms, onedrive.live.com).");
  }

  if (net.isIP(host)) {
    throw new Error("IP addresses are not permitted for SharePoint sync URLs.");
  }

  try {
    const records = await lookup(host, { all: true });
    if (records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
      throw new Error("SharePoint host resolved to a restricted network address.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("restricted network address")) throw err;
    throw new Error("Could not resolve SharePoint hostname.");
  }

  return u;
}

let cachedGraphToken: { token: string; expiresAt: number } | null = null;

function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchMicrosoftGraphToken(forceClientCredentials = false): Promise<{
  token: string;
  source: "env" | "client_credentials";
} | null> {
  if (!forceClientCredentials && process.env.MS_GRAPH_ACCESS_TOKEN?.trim()) {
    const envToken = process.env.MS_GRAPH_ACCESS_TOKEN.trim();
    const expMs = decodeJwtExpiryMs(envToken);
    if (!expMs || expMs > Date.now() + 30_000) {
      return { token: envToken, source: "env" };
    }
  }

  if (!forceClientCredentials && cachedGraphToken && cachedGraphToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedGraphToken.token, source: "client_credentials" };
  }

  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!tokenRes.ok) return null;
    const data = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    const ttlMs = Math.max(60, Number(data.expires_in) || 3600) * 1000;
    cachedGraphToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
    return { token: data.access_token, source: "client_credentials" };
  } catch {
    return null;
  }
}

function buildGraphSiteDriveContentUrl(parsedUrl: URL): string | null {
  const cleanedPath = parsedUrl.pathname.replace(/^\/:[xwbp]:\/[rgcs]\//i, "/");
  const match = cleanedPath.match(/^(\/(?:personal|sites|teams)\/[^/]+)\/(.+)$/i);
  if (!match) return null;
  const [, sitePath, relPath] = match;
  let decodedRel: string;
  try {
    decodedRel = decodeURIComponent(relPath);
  } catch {
    decodedRel = relPath;
  }
  const encodedSite = `${parsedUrl.hostname}:${sitePath}`;
  const encodedRel = decodedRel
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  if (!encodedRel) return null;
  return `https://graph.microsoft.com/v1.0/sites/${encodedSite}:/drive/root:/${encodedRel}:/content`;
}

class DownloadSizeLimitError extends Error {
  constructor(maxBytes: number) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    super(`Remote workbook exceeds the ${mb} MB download limit.`);
    this.name = "DownloadSizeLimitError";
  }
}

async function readResponseArrayBufferWithCap(
  response: Response,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<ArrayBuffer> {
  const clHeader = response.headers.get("content-length");
  if (clHeader) {
    const cl = Number(clHeader);
    if (Number.isFinite(cl) && cl > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new DownloadSizeLimitError(maxBytes);
    }
  }

  if (!response.body) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new DownloadSizeLimitError(maxBytes);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new DownloadSizeLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

async function fetchGraphWorkbookBuffer(
  shareUrl: string,
  parsedUrl: URL,
  token: string,
): Promise<{ status: number; buffer?: ArrayBuffer; errorText?: string }> {
  const endpoints = [
    `https://graph.microsoft.com/v1.0/shares/${encodeGraphSharingToken(shareUrl)}/driveItem/content`,
  ];
  const siteUrl = buildGraphSiteDriveContentUrl(parsedUrl);
  if (siteUrl) endpoints.push(siteUrl);

  let lastStatus = 0;
  let lastErrorText = "";

  for (const endpoint of endpoints) {
    let currentUrl = endpoint;
    let sendBearer = true;
    for (let hop = 0; hop <= 5; hop++) {
      await validateSharePointUrl(currentUrl, true);
      const res: Response = await fetch(currentUrl, {
        headers: sendBearer ? { Authorization: `Bearer ${token}` } : {},
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status >= 300 && res.status < 400) {
        const location: string | null = res.headers.get("location");
        if (!location) {
          lastStatus = res.status;
          break;
        }
        const nextUrl: URL = new URL(location, currentUrl);
        // Never leak Graph Bearer token onto SharePoint CDN / pre-signed redirect targets
        sendBearer = nextUrl.hostname.toLowerCase() === "graph.microsoft.com";
        currentUrl = nextUrl.toString();
        continue;
      }

      lastStatus = res.status;
      if (res.ok) {
        const buffer = await readResponseArrayBufferWithCap(res, MAX_DOWNLOAD_BYTES);
        return { status: res.status, buffer };
      }

      if (res.status === 401) {
        return { status: 401 };
      }
      lastErrorText = await res.text().catch(() => "");
      break;
    }
  }

  return { status: lastStatus, errorText: lastErrorText };
}

function isZipXlsxBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  return (
    bytes.length === 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function buildSharePointCandidateUrls(rawUrl: string): string[] {
  const candidates: string[] = [];
  try {
    const u = new URL(rawUrl.trim());
    const cleanedPath = u.pathname.replace(/^\/:[xwbp]:\/[rgcs]\//i, "/");
    const siteMatch = cleanedPath.match(/^(\/(?:personal|sites|teams)\/[^/]+)\/(.+)$/i);

    // Strategy 0: Direct SharePoint _layouts/15/download.aspx?UniqueId=... when sharing link includes d=w<hex32>
    const dParam = u.searchParams.get("d");
    const uniqueMatch = dParam?.match(/^w([0-9a-f]{32})$/i);
    if (uniqueMatch && siteMatch) {
      const hex = uniqueMatch[1];
      const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const [, sitePath] = siteMatch;
      const directUnique = new URL(`${u.origin}${sitePath}/_layouts/15/download.aspx`);
      directUnique.searchParams.set("UniqueId", uuid);
      candidates.push(directUnique.toString());
    }

    // Strategy 1: Original URL with download=1 appended
    const dlUrl = new URL(u.toString());
    dlUrl.searchParams.set("download", "1");
    candidates.push(dlUrl.toString());

    // Strategy 2: Original URL as-is (to capture any guest session cookie before requesting download=1)
    candidates.push(u.toString());

    // Strategy 3: Convert /:x:/r/... or /:x:/g/... to direct path with download=1
    if (cleanedPath !== u.pathname) {
      const direct = new URL(u.origin + cleanedPath);
      direct.searchParams.set("download", "1");
      candidates.push(direct.toString());
    }

    // Strategy 4: SharePoint _layouts/15/download.aspx under the personal or team site
    if (siteMatch) {
      const [, sitePath, fileRelPath] = siteMatch;
      let decodedRel = fileRelPath;
      try {
        decodedRel = decodeURIComponent(fileRelPath);
      } catch {
        // leave encoded segment as-is if malformed
      }
      const layoutUrl = new URL(`${u.origin}${sitePath}/_layouts/15/download.aspx`);
      layoutUrl.searchParams.set("SourceUrl", `${sitePath}/${decodedRel}`);
      candidates.push(layoutUrl.toString());
    }
  } catch {
    // ignore invalid URL here, handled by caller
  }
  return candidates;
}

function resolveConfiguredSharePointCookie(): string | null {
  return process.env.SHAREPOINT_COOKIE?.trim() || null;
}

/**
 * Follows HTTP redirects manually while validating each hop against SSRF rules
 * and keeping cookies strictly scoped to their exact origin.
 */
async function fetchWithCookieJar(
  initialUrl: string,
  configuredOrigin: string,
  maxRedirects = 8,
): Promise<{ response: Response; finalUrl: string }> {
  const originCookies = new Map<string, Map<string, string>>();
  const configuredCookie = resolveConfiguredSharePointCookie();
  if (configuredCookie) {
    const initialOrigin = new URL(initialUrl).origin;
    if (initialOrigin === configuredOrigin) {
      const spMap = new Map<string, string>();
      for (const part of configuredCookie.split(";")) {
        const idx = part.indexOf("=");
        if (idx > 0) {
          spMap.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
        }
      }
      if (spMap.size > 0) {
        originCookies.set(configuredOrigin, spMap);
      }
    }
  }

  let currentUrl = initialUrl;
  let lastResponse: Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await validateSharePointUrl(currentUrl, hop > 0);
    const jarForOrigin = originCookies.get(validated.origin);
    const cookieHeader = jarForOrigin
      ? [...jarForOrigin.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
      : "";

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*",
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const res = await fetch(validated.toString(), {
      redirect: "manual",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    lastResponse = res;

    // Collect Set-Cookie headers scoped to this exact origin
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie")!]
          : [];
    if (setCookies.length > 0) {
      let jar = originCookies.get(validated.origin);
      if (!jar) {
        jar = new Map<string, string>();
        originCookies.set(validated.origin, jar);
      }
      for (const sc of setCookies) {
        const firstPair = sc.split(";")[0]?.trim();
        if (!firstPair) continue;
        const eq = firstPair.indexOf("=");
        if (eq > 0) {
          jar.set(firstPair.slice(0, eq).trim(), firstPair.slice(eq + 1).trim());
        }
      }
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      const nextUrl = new URL(location, validated);
      // Never forward configured SHAREPOINT_COOKIE to any origin other than configuredOrigin
      currentUrl = nextUrl.toString();
      continue;
    }

    break;
  }

  return { response: lastResponse!, finalUrl: currentUrl };
}

export async function fetchAndParseSharePointWorkbook(
  shareUrl: string,
  previousHash?: string | null,
): Promise<
  | { ok: true; unchanged: true; fileHash: string }
  | { ok: true; unchanged: false; fileHash: string; result: ParseResult }
  | { ok: false; needsAuth: boolean; error: string }
> {
  let parsedUrl: URL;
  try {
    parsedUrl = await validateSharePointUrl(shareUrl);
  } catch (err) {
    return {
      ok: false,
      needsAuth: false,
      error: err instanceof Error ? err.message : "Enter a valid SharePoint or OneDrive workbook URL.",
    };
  }

  // 1. If Microsoft Graph credentials are configured, try Graph first
  let graphAuth = await fetchMicrosoftGraphToken();
  if (graphAuth) {
    let graphSizeError: string | null = null;
    const runGraph = async (token: string) => {
      try {
        return await fetchGraphWorkbookBuffer(shareUrl, parsedUrl, token);
      } catch (err) {
        if (err instanceof DownloadSizeLimitError) {
          graphSizeError = err.message;
        }
        return { status: 0, buffer: undefined, errorText: undefined };
      }
    };

    let graphAttempt = await runGraph(graphAuth.token);
    if (graphSizeError) {
      return { ok: false, needsAuth: false, error: graphSizeError };
    }
    if (graphAttempt.status === 401) {
      cachedGraphToken = null;
      graphAuth = await fetchMicrosoftGraphToken(true);
      if (graphAuth) {
        graphAttempt = await runGraph(graphAuth.token);
        if (graphSizeError) {
          return { ok: false, needsAuth: false, error: graphSizeError };
        }
      }
    }

    if (graphAttempt.buffer) {
      if (!isZipXlsxBuffer(graphAttempt.buffer)) {
        return {
          ok: false,
          needsAuth: false,
          error: "Microsoft Graph returned a response that is not a valid .xlsx workbook.",
        };
      }
      const fileHash = hashBuffer(graphAttempt.buffer);
      if (previousHash && previousHash === fileHash) {
        return { ok: true, unchanged: true, fileHash };
      }
      try {
        const result = await parseXlsxBuffer(graphAttempt.buffer);
        return { ok: true, unchanged: false, fileHash, result };
      } catch (err) {
        return {
          ok: false,
          needsAuth: false,
          error:
            err instanceof Error
              ? err.message
              : "Downloaded workbook from Microsoft Graph could not be parsed.",
        };
      }
    }

    if (graphAttempt.status === 401 || graphAttempt.status === 403) {
      return {
        ok: false,
        needsAuth: true,
        error:
          "Microsoft Graph access was denied for that SharePoint workbook (check MS_GRAPH_ACCESS_TOKEN or app permissions Files.Read.All / Sites.Read.All).",
      };
    }
  }

  // 2. Try direct SharePoint download candidate URLs within an overall budget
  const candidateUrls = buildSharePointCandidateUrls(parsedUrl.toString());
  let sawAuthRedirect = false;
  let lastParseError: string | null = null;

  for (const url of candidateUrls) {
    try {
      const { response, finalUrl } = await fetchWithCookieJar(url, parsedUrl.origin);
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const finalLower = finalUrl.toLowerCase();

      if (
        finalLower.includes("login.microsoftonline.com") ||
        finalLower.includes("login.windows.net") ||
        finalLower.includes("login.live.com") ||
        finalLower.includes("/_forms/default.aspx") ||
        finalLower.includes("authenticate.aspx") ||
        finalLower.includes("accessdenied.aspx") ||
        finalLower.includes("/adfs/ls") ||
        response.status === 401 ||
        response.status === 403
      ) {
        await response.body?.cancel().catch(() => {});
        sawAuthRedirect = true;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        continue;
      }

      const buffer = await readResponseArrayBufferWithCap(response, MAX_DOWNLOAD_BYTES);
      const isZip = isZipXlsxBuffer(buffer);

      if (!isZip || contentType.includes("text/html")) {
        const textSnippet = new TextDecoder().decode(buffer.slice(0, 16_384));
        if (
          /login\.microsoftonline|login\.windows\.net|sign\s*in\s+to\s+your\s+account|enter\s+your\s+password|aadsts|fedauth|microsoft\s+account/i.test(
            textSnippet,
          )
        ) {
          sawAuthRedirect = true;
        }
        continue;
      }

      const fileHash = hashBuffer(buffer);
      if (previousHash && previousHash === fileHash) {
        return { ok: true, unchanged: true, fileHash };
      }

      try {
        const result = await parseXlsxBuffer(buffer);
        return { ok: true, unchanged: false, fileHash, result };
      } catch (err) {
        lastParseError =
          err instanceof Error ? err.message : "Could not parse downloaded .xlsx workbook.";
        break;
      }
    } catch (err) {
      if (err instanceof DownloadSizeLimitError) {
        return { ok: false, needsAuth: false, error: err.message };
      }
      continue;
    }
  }

  if (lastParseError) {
    return { ok: false, needsAuth: false, error: lastParseError };
  }

  if (sawAuthRedirect) {
    return {
      ok: false,
      needsAuth: true,
      error:
        "SharePoint returned a Microsoft 365 sign-in wall (login.microsoftonline.com). To enable automatic background sync whenever the file changes, either: (1) set the SharePoint link permission to 'Anyone with the link can view', (2) connect a 2-step Power Automate flow to the Webhook URL below, or (3) configure MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET in the server environment.",
    };
  }

  return {
    ok: false,
    needsAuth: false,
    error:
      "Could not download an .xlsx workbook from that URL. Check the link or upload the .xlsx file directly.",
  };
}

/* ---------------------------------------------------------------- entry -- */

export async function parseCalendarFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".ics")) return parseIcs(await file.text());
  if (name.endsWith(".csv")) return parseCsv(await file.text());
  if (name.endsWith(".xlsx")) return parseXlsxBuffer(await file.arrayBuffer());
  throw new Error("Only .ics, .csv and .xlsx files are supported.");
}
