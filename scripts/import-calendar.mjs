#!/usr/bin/env node
/**
 * Imports the IICA-TT monthly calendar workbook (`2026 Team-TT Calendar.xlsx`)
 * or repairs existing calendar records in PostgreSQL.
 *
 * Usage:
 *   node scripts/import-calendar.mjs "2026 Team-TT Calendar.xlsx"
 *   node scripts/import-calendar.mjs --repair
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  INITIALS_ALIASES,
  cellText,
  createScriptSql,
  fail,
  loadEnvFiles,
  resolveDatabaseUrl,
} from "./_lib.mjs";

loadEnvFiles();

const DATABASE_URL = resolveDatabaseUrl();
if (!DATABASE_URL) fail("DATABASE_URL is not set.");

const arg = process.argv[2];
if (!arg) fail("Usage: node scripts/import-calendar.mjs <calendar.xlsx | --repair>");
if (arg !== "--repair" && !fs.existsSync(arg)) fail(`No such file: ${arg}`);

const db = createScriptSql(DATABASE_URL);

const TT_UTC_OFFSET_HOURS = 4;
const makeTrinidadDate = (year, month, day, hour = 9, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour + TT_UTC_OFFSET_HOURS, minute, 0));

const trinidadParts = (d) => {
  const shifted = new Date(d.getTime() - TT_UTC_OFFSET_HOURS * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayKey: shifted.toISOString().slice(0, 10),
  };
};

const SHEET_MONTH_MAP = {
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

const NON_EVENT_PATTERNS = [
  /^links?\s+to\s+act[i]?vity\s+briefs?$/i,
  /^notes?\s+for\s+bop$/i,
  /^notes?(?:\s*\d+)?\s*:/i,
  /^sfc$/i,
  /^\d{3,}[a-z]{1,3}$/i,
  /^\d{1,2}\s+(or|to)\s+\d{1,2}\s+[a-z]+$/i,
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|sat|sun)$/i,
  /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}$/i,
  /^20\d{2}\s+team-tt\s+calendar/i,
];

function isNonEventBanner(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || /^\d{1,2}$/.test(trimmed)) return true;
  return NON_EVENT_PATTERNS.some((re) => re.test(trimmed));
}

function clean(value) {
  return cellText(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function classifyEventType(rawText) {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const isMeetingWithNote =
    /\b(mtg|meeting|session|workshop|webinar|consultation|briefing|seminar|training)\b/i.test(text) &&
    !/^(vaca|vacation|sick|med\s*leave|wfh\s*[:|-]|out\s+of\s+office)/i.test(text);

  if (!isMeetingWithNote) {
    if (
      /^(vaca|vacation|sick|med\s*leave|wfh\b)/i.test(text) ||
      /\b(vacation|vaca\b|sick\s*day|sick\s*:|med\s*leave|out[\s-]+of[\s-]+office|comp\s*day|comptime)\b/i.test(
        lower,
      )
    ) {
      return "LEAVE";
    }
  }
  if (
    /\b(carnival|carvnial|divali|corpus\s+christi(?!\s+(?:college|secondary|school))|labour\s+day|emancipation(?!\s+village)|indian\s+arrival|spiritual\s+baptist|good\s+friday|easter\s+monday|eid\b|republic\s+day|independence\s+day|holiday\s+observed|public\s+holiday|nat+ional\s+holiday|holiday)\b/i.test(
      lower,
    )
  ) {
    return "HOLIDAY";
  }
  if (
    /(?:\bdeadline\b|\bdue\s*:|\bclosing\s+accounts\b|\breport\s*prep\b|\bpayments?\s*(?:4|for)?\s*processing\b|\brequest\s+(?:of|for)\s+(?:funds|cash)\b|\bconcept\s+note\b|\bsugi\b|\bknowledge\s+products\b|\bmonthly\s+listing\b|\bbudget\s+update\b|\baccountability\b|\bsubmit(?:ted|tal)?\b|\brpt\s+submitted\b|\bcompleted\s+wfp\s+reports\b|\bdeliverables?\b)/i.test(
      lower,
    )
  ) {
    return "DEADLINE";
  }
  if (
    /\b(training|workshop|wkshp|field\s+visit|field\s+session|field\s+simulation|mission|travel\s+mission|study\s+tour|expo\b|symposium|seminar|clinic\b|honey\s+fest|honey\s+festival|school\s+garden|land\s+prep)\b/i.test(
      lower,
    ) ||
    /\bproject\s*-\s*(?:antigua|dominica|colombia|barbados|guyana|suriname|bahamas)\b/i.test(lower)
  ) {
    return "MISSION";
  }
  if (
    /^(?:tbc\s*:|appointment$)/i.test(text) ||
    /\b(black[\s-]*out|cpe\s*course|course)\b/i.test(lower)
  ) {
    return "OTHER";
  }
  return "MEETING";
}

function to24Hour(hour, meridiem) {
  if (meridiem === "pm" && hour < 12) return hour + 12;
  if (meridiem === "am" && hour === 12) return 0;
  return hour;
}

function inferStartMeridiem(startH, endH, endMeridiem) {
  if (endMeridiem === "am") return "am";
  if (endH === 12) return startH === 12 ? "pm" : "am";
  if (startH >= 7 && startH <= 11 && (startH > endH || endH <= 6)) return "am";
  return "pm";
}

function extractTiming(raw) {
  const text = raw
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/(\d{1,2});(\d{2})\s*(am|pm)/gi, "$1:$2$3")
    .replace(/(\d{1,2})::(\d{2})/g, "$1:$2")
    .replace(/(\d{1,2}):(\d{2}):\d{2}\s*(am|pm)/gi, "$1:$2$3")
    .replace(/(\d{1,2}):(\d)\s*(am|pm)/gi, "$1:0$2$3")
    .replace(/(\d{1,2}(?::\d{2})?)\s*m\s*-\s*(\d{1,2}:\d{2})/gi, "$1am-$2")
    .replace(/(\d{1,2}):\s*(am|pm)/gi, "$1:00$2")
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*apm\b/gi, (_, t) => {
      const h = parseInt(String(t).split(":")[0], 10);
      return `${t}${h >= 7 && h <= 11 ? "am" : "pm"}`;
    })
    .trim();

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

  const prefixMatch = text.match(/^(?:IICA\s+EVENT\s+|(?:PRIORITY|TBC|TBD)\s*:?\s+)/i);
  const rawPrefix = prefixMatch ? prefixMatch[0] : "";
  const body = rawPrefix ? text.slice(rawPrefix.length).trim() : text;
  const keepPrefix = /^IICA\s+EVENT\s+/i.test(rawPrefix)
    ? rawPrefix
    : /^(TBC|TBD)/i.test(rawPrefix)
      ? `${rawPrefix.trim().replace(/:$/, "")}: `
      : "";

  const rangeStartRe =
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)?(?:\s*\(tbc\))?\s*(?:[:.\-|]\s*|\s+)/i;
  const rangeMatch = body.match(rangeStartRe);
  if (rangeMatch) {
    const [, h1Raw, m1Raw, mer1Raw, h2Raw, m2Raw, mer2Raw] = rangeMatch;
    const h1 = Number(h1Raw);
    const m1 = Number(m1Raw ?? 0);
    const h2 = Number(h2Raw);
    const m2 = Number(m2Raw ?? 0);
    const norm = (m, h) => {
      if (!m) return null;
      const low = m.toLowerCase();
      if (low === "noon") return "pm";
      if (low === "am" || low === "pm") return low;
      return h >= 7 && h <= 11 ? "am" : "pm";
    };
    let mer2 = norm(mer2Raw, h2);
    let mer1 = norm(mer1Raw, h1);
    if (mer1 || mer2 || m1Raw !== undefined || m2Raw !== undefined) {
      if (!mer2) mer2 = mer1 === "am" && h2 < h1 ? "pm" : mer1 || (h2 >= 7 && h2 <= 11 ? "am" : "pm");
      if (!mer1) mer1 = inferStartMeridiem(h1, h2, mer2);
      let startHour = to24Hour(h1, mer1);
      let endHour = to24Hour(h2, mer2);
      if (startHour >= 1 && startHour <= 5 && mer1 === "am" && mer2 === "am") {
        startHour += 12;
        if (endHour >= 1 && endHour <= 6) endHour += 12;
      }
      if (endHour <= startHour && h2 === 12) endHour = 12;
      if (endHour < startHour && h2 >= 1 && h2 <= 6 && mer2 === "am") endHour = h2 + 12;
      if (endHour < startHour || (endHour === startHour && m2 <= m1)) endHour = Math.min(23, startHour + 1);
      const cleaned = (keepPrefix + body.slice(rangeMatch[0].length)).trim();
      return {
        startHour: Math.max(0, Math.min(23, startHour)),
        startMinute: Math.max(0, Math.min(59, m1)),
        endHour: Math.max(0, Math.min(23, endHour)),
        endMinute: Math.max(0, Math.min(59, m2)),
        allDay: false,
        cleanedText: cleaned || text,
      };
    }
  }

  const singleStartRe =
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)\b(?:\s*\(tbc\))?\s*(?:[:.\-|]\s*|\s+)/i;
  const singleMatch = body.match(singleStartRe);
  if (singleMatch) {
    const [, hRaw, mRaw, merRaw] = singleMatch;
    const h = Number(hRaw);
    const m = Math.max(0, Math.min(59, Number(mRaw ?? 0)));
    const mer = merRaw.toLowerCase() === "am" ? "am" : "pm";
    const startHour = Math.max(0, Math.min(23, to24Hour(h, mer)));
    const endHour = Math.min(23, startHour + 1);
    const cleaned = (keepPrefix + body.slice(singleMatch[0].length)).trim();
    return { startHour, startMinute: m, endHour, endMinute: m, allDay: false, cleanedText: cleaned || text };
  }

  const embeddedRangeRe = /\btime\s+(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon)\b/i;
  const embRange = text.match(embeddedRangeRe);
  if (embRange) {
    const h1 = Number(embRange[1]);
    const m1 = Math.max(0, Math.min(59, Number(embRange[2] ?? 0)));
    const h2 = Number(embRange[3]);
    const m2 = Math.max(0, Math.min(59, Number(embRange[4] ?? 0)));
    const mer2 = embRange[5].toLowerCase() === "am" ? "am" : "pm";
    const mer1 = inferStartMeridiem(h1, h2, mer2);
    const startHour = Math.max(0, Math.min(23, to24Hour(h1, mer1)));
    const endHour = Math.max(startHour + 1, Math.min(23, to24Hour(h2, mer2)));
    return { startHour, startMinute: m1, endHour, endMinute: m2, allDay: false, cleanedText: text };
  }

  const embeddedSingleRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  const embSingle = text.match(embeddedSingleRe);
  if (embSingle) {
    const h = Number(embSingle[1]);
    const m = Math.max(0, Math.min(59, Number(embSingle[2] ?? 0)));
    const mer = embSingle[3].toLowerCase() === "am" ? "am" : "pm";
    const startHour = Math.max(0, Math.min(23, to24Hour(h, mer)));
    const endHour = Math.min(23, startHour + 1);
    return { startHour, startMinute: m, endHour, endMinute: m, allDay: false, cleanedText: text };
  }

  return { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0, allDay: true, cleanedText: text };
}

const LEAD_CODE_RE = /\b(DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)\b/;

function extractMetadata(cleanedText, dayOfMonth) {
  let work = cleanedText.trim();
  const leadDayMatch = work.match(/^(\d{1,2})\s+(?=[A-Za-z])/);
  if (leadDayMatch && (!dayOfMonth || Number(leadDayMatch[1]) === dayOfMonth)) {
    work = work.slice(leadDayMatch[0].length).trim();
  }

  const notes = [];
  let location = null;
  let leadInitials = null;

  const urlMatch = work.match(/https?:\/\/\S+(?:\s+Passcode:\s*\S+)?/i);
  if (urlMatch) {
    notes.push(urlMatch[0].trim());
    work = work.replace(urlMatch[0], "").trim();
    if (/zoom\.us|teams\.microsoft|meet\.google/i.test(urlMatch[0])) location = "Zoom / Virtual";
  }

  const bracketMatches = [...work.matchAll(/[\[{(]([^\]})]{2,60})[\]})]/g)];
  const staffTokens = [];
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
    if (
      /\b(DEF|DF|LH|RR|MA|JL|GH|GEH|SE|VAB|VB|EF|AD|EC|CSM|KCM|KSM|CJ|all\s+staff|all\s+tt\s+team|team|interns|all\s+available\s+staff)\b/i.test(
        inside,
      )
    ) {
      staffTokens.push(inside);
      if (!leadInitials) {
        const firstMatch = inside.toUpperCase().match(LEAD_CODE_RE);
        if (firstMatch) leadInitials = firstMatch[1];
      }
      work = work.replace(m[0], "").trim();
    }
  }

  if (!leadInitials) {
    const prefixInitials = work.match(
      /^(?:vaca(?:tion)?|sick(?:\s*day)?|med\s*leave|wfh)?\s*[:|-]?\s*\b(DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)\b/,
    );
    if (prefixInitials) leadInitials = prefixInitials[1];
  }

  const atLocationMatch = work.match(/(?:^|\s)@\s*([^[\];|\-–—]+?)(?=\s+(?:\+[A-Z]{2,3}\b|[-–—])|$)/);
  if (atLocationMatch) {
    const rawLoc = atLocationMatch[1].replace(/[.,;]+$/, "").trim();
    if (rawLoc) {
      location = /^iica(-tt)?$/i.test(rawLoc) ? "IICA-TT Office" : rawLoc;
      work = work.replace(atLocationMatch[0], " ").trim();
    }
  }

  if (!location) {
    if (/\b(virtual|zoom|webinar|emeeting|online\s+mtg)\b/i.test(work)) location = "Zoom / Virtual";
    else if (/\biica-tt\s+conference\s+room\b/i.test(work)) location = "IICA-TT Conference Room";
    else if (/\bhyatt(\s+regency)?\b/i.test(work)) location = "Hyatt Regency";
    else if (/\bat\s+hilton\b/i.test(work)) location = "Hilton Trinidad";
    else if (/\bchaguanas\s+borough\s+corporation\s+auditorium\b/i.test(work))
      location = "Chaguanas Borough Corporation Auditorium";
    else if (/\buwi\s+field\s+station\b/i.test(work)) location = "UWI Field Station";
    else if (/\bmarac(\s+community\s+center)?\b/i.test(work)) location = "Marac, Moruga";
    else if (/\bnamdevco\s+packing\s+house\b/i.test(work)) location = "NAMDEVCO Packing House, Piarco";
    else if (/\bmacoya\b/i.test(work)) location = "Macoya";
    else if (/(?<!trinidad\s+(?:and|&)\s+)\btobago\b/i.test(work)) location = "Tobago";
  }

  if (staffTokens.length > 0) notes.unshift(`Participants: ${staffTokens.join(", ")}`);

  work = work
    .replace(/\s+/g, " ")
    .replace(/^[:\-|]+\s*/, "")
    .replace(/\s*[:\-|,+]+$/, "")
    .trim();

  const rawTitle = (work || cleanedText.trim()).slice(0, 240);
  const rawDesc = notes.length ? notes.join("\n") : null;
  return {
    title: expandStaffInitials(rawTitle).slice(0, 240),
    location,
    description: rawDesc ? expandStaffInitials(rawDesc) : null,
    leadInitials,
  };
}

function expandStaffInitials(raw) {
  const expandChunk = (segment) =>
    segment
      .replace(/\bVACATION\b/g, "Vacation")
      .replace(/\bNattional Holiday\b/gi, "National Holiday")
      .replace(/\bOpertaions\b/gi, "Operations")
      .replace(/\bPortfilio\b/gi, "Portfolio")
      .replace(/\bInvititation\b/gi, "Invitation")
      .replace(/\bSTaff\b/g, "Staff")
      .replace(/(^|\s)-+(?=[A-Z])/g, "$1")
      .replace(
        /(?<![A-Za-z0-9/])(DEF|DF|LH|RR|MA|JL|GEH|GH|SE|VAB|VB|EF|AD|EC)(?![A-Za-z0-9/])/g,
        (code) => INITIALS_ALIASES[code] ?? code,
      )
      .replace(/\s*,\s*$/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  return raw
    .split(/(https?:\/\/\S+)/gi)
    .map((part, idx) => (idx % 2 === 1 ? part : expandChunk(part)))
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

async function loadInitialsMap() {
  const users = await db`SELECT id, name FROM users WHERE status = 'ACTIVE' ORDER BY id`;
  const byInitials = new Map();
  for (const user of users) {
    const ini = user.name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join("");
    if (ini && !byInitials.has(ini)) byInitials.set(ini, user.id);
  }
  for (const [alias, fullName] of Object.entries(INITIALS_ALIASES)) {
    const match = users.find((u) => u.name.toLowerCase() === fullName.toLowerCase());
    if (match) byInitials.set(alias, match.id);
  }
  return byInitials;
}

try {
  const byInitials = await loadInitialsMap();

  if (arg === "--repair") {
    let repaired = 0;
    let deleted = 0;
    let syncedFromTimelines = 0;

    await db.begin(async (tx) => {
      const rows = await tx`SELECT * FROM calendar_events ORDER BY id`;
      for (const row of rows) {
        if (row.source === "MANUAL") continue;

        if (isNonEventBanner(row.title)) {
          await tx`DELETE FROM calendar_events WHERE id = ${row.id}`;
          deleted++;
          continue;
        }

        const { year, month, day, dayKey } = trinidadParts(row.starts_at);
        const timing = extractTiming(row.title);
        const meta = extractMetadata(timing.cleanedText, day);
        if (isNonEventBanner(meta.title)) {
          await tx`DELETE FROM calendar_events WHERE id = ${row.id}`;
          deleted++;
          continue;
        }

        const organiserId =
          row.organiser_id ?? (meta.leadInitials ? byInitials.get(meta.leadInitials) ?? null : null);
        const newLocation = row.location || meta.location;
        const newDescription = row.description || meta.description;
        const newStart = !timing.allDay
          ? makeTrinidadDate(year, month, day, timing.startHour, timing.startMinute)
          : row.starts_at;
        const newEnd = !timing.allDay
          ? makeTrinidadDate(year, month, day, timing.endHour, timing.endMinute)
          : row.ends_at;
        const newAllDay = timing.allDay && row.all_day;
        const sourceKey = row.source_key ?? `${dayKey}|${meta.title.trim().toLowerCase()}`;

        await tx`
          UPDATE calendar_events
             SET title = ${meta.title},
                 starts_at = ${newStart},
                 ends_at = ${newEnd > newStart ? newEnd : new Date(newStart.getTime() + 3600000)},
                 all_day = ${newAllDay},
                 location = ${newLocation},
                 description = ${newDescription},
                 organiser_id = ${organiserId},
                 source_key = ${sourceKey},
                 updated_at = now()
           WHERE id = ${row.id}`;
        repaired++;
      }

      const tasks = await tx`
        SELECT id, area, title, lead, origin, starts_on, ends_on, schedule_note, comments, owner_id, status
          FROM staff_tasks`;

      const monthLookup = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
      };

      const insertTimelineEvent = async (ev, taskId) => {
        const { dayKey } = trinidadParts(ev.start);
        const sourceKey = `timeline:${taskId}:${dayKey}`;
        const dayStart = makeTrinidadDate(
          Number(dayKey.slice(0, 4)),
          Number(dayKey.slice(5, 7)),
          Number(dayKey.slice(8, 10)),
          0,
          0,
        );
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        const exists = await tx`
          SELECT 1 FROM calendar_events
           WHERE source_key = ${sourceKey}
              OR (lower(title) = lower(${ev.title}) AND starts_at >= ${dayStart} AND starts_at < ${dayEnd})
           LIMIT 1`;
        if (exists.length) return;

        await tx`
          INSERT INTO calendar_events
            (title, description, event_type, starts_at, ends_at, all_day, location, organiser_id, source, source_key)
          VALUES
            (${ev.title}, ${ev.description}, ${ev.eventType}, ${ev.start}, ${ev.end},
             ${ev.allDay}, ${ev.location}, ${ev.organiserId}, 'TIMELINES', ${sourceKey})`;
        syncedFromTimelines++;
      };

      const currentYear = new Date().getFullYear();
      for (const task of tasks) {
        const firstLead = task.lead?.split(/[/,&+\-]+/)[0]?.trim().toUpperCase() || null;
        const organiserId = task.owner_id ?? (firstLead ? byInitials.get(firstLead) ?? null : null);
        const descParts = [
          `Timeline Area: ${task.area}`,
          task.lead ? `Lead: ${task.lead}` : null,
          task.origin ? `Origin: ${task.origin}` : null,
          task.schedule_note ? `Schedule: ${task.schedule_note}` : null,
          task.comments ? `Notes: ${task.comments}` : null,
        ].filter(Boolean);
        const description = descParts.join(" · ");
        const eventType = /report\s+prep|payments|request\s+for\s+cash|concept\s+note|sugi/i.test(task.title)
          ? "DEADLINE"
          : classifyEventType(task.title);
        const timing = task.schedule_note ? extractTiming(task.schedule_note) : null;

        if (task.starts_on || task.ends_on) {
          const startDay = task.starts_on ?? task.ends_on;
          const endDay = task.ends_on ?? task.starts_on;
          const y1 = startDay.getUTCFullYear();
          const m1 = startDay.getUTCMonth() + 1;
          const d1 = startDay.getUTCDate();
          const y2 = endDay.getUTCFullYear();
          const m2 = endDay.getUTCMonth() + 1;
          const d2 = endDay.getUTCDate();
          const isMultiDay = y1 !== y2 || m1 !== m2 || d1 !== d2;
          const allDay = isMultiDay || !timing || timing.allDay;
          const start = allDay
            ? makeTrinidadDate(y1, m1, d1, 9, 0)
            : makeTrinidadDate(y1, m1, d1, timing.startHour, timing.startMinute);
          const end = isMultiDay
            ? makeTrinidadDate(y2, m2, d2, 17, 0)
            : allDay
              ? makeTrinidadDate(y1, m1, d1, 17, 0)
              : makeTrinidadDate(y1, m1, d1, timing.endHour, timing.endMinute);
          await insertTimelineEvent(
            {
              title: task.title,
              description,
              eventType,
              start,
              end: end > start ? end : new Date(start.getTime() + 3600000),
              allDay,
              location: /\bin\s+person\b/i.test(task.title)
                ? "In Person"
                : /\bwebinar\b/i.test(task.title)
                  ? "Zoom / Virtual"
                  : null,
              organiserId,
            },
            task.id,
          );
          continue;
        }

        if (task.schedule_note) {
          const segments = task.schedule_note.split(/[·;]/);
          let currentMonth = null;
          for (const seg of segments) {
            const cleanSeg = seg.split("—")[0].trim();
            const mMatch = cleanSeg.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
            if (mMatch) currentMonth = monthLookup[mMatch[1].toLowerCase()] ?? null;
            if (!currentMonth || /\b(na|tbc|ongoing)\b/i.test(cleanSeg)) continue;
            const maxDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();

            const rangeDayMatch = cleanSeg.match(/(\d{1,2})\s*-\s*(\d{1,2})(?!\s*(?:am|pm|:\d{2}))/i);
            if (rangeDayMatch) {
              const dStart = Number(rangeDayMatch[1]);
              const dEnd = Number(rangeDayMatch[2]);
              if (dStart >= 1 && dStart <= maxDay && dEnd >= dStart && dEnd <= maxDay) {
                await insertTimelineEvent(
                  {
                    title: task.title,
                    description,
                    eventType,
                    start: makeTrinidadDate(currentYear, currentMonth, dStart, 9, 0),
                    end: makeTrinidadDate(currentYear, currentMonth, dEnd, 17, 0),
                    allDay: true,
                    location: null,
                    organiserId,
                  },
                  task.id,
                );
                continue;
              }
            }

            const dayNumbers = [...cleanSeg.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
            for (const dayNum of dayNumbers) {
              if (dayNum < 1 || dayNum > maxDay) continue;
              const hasTime = timing && !timing.allDay;
              const start = hasTime
                ? makeTrinidadDate(currentYear, currentMonth, dayNum, timing.startHour, timing.startMinute)
                : makeTrinidadDate(currentYear, currentMonth, dayNum, 9, 0);
              const end = hasTime
                ? makeTrinidadDate(currentYear, currentMonth, dayNum, timing.endHour, timing.endMinute)
                : makeTrinidadDate(currentYear, currentMonth, dayNum, 17, 0);
              await insertTimelineEvent(
                {
                  title: task.title,
                  description,
                  eventType,
                  start,
                  end: end > start ? end : new Date(start.getTime() + 3600000),
                  allDay: !hasTime,
                  location: null,
                  organiserId,
                },
                task.id,
              );
            }
          }
        }
      }

      await tx`
        INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
        VALUES (NULL, 'system (import-calendar script)', 'UPDATE', 'calendar_event', NULL,
                ${`Repair & timeline sync: ${repaired} repaired, ${deleted} banners removed, ${syncedFromTimelines} timeline events added`})`;
    });

    console.log(
      `Repaired ${repaired} events, removed ${deleted} non-event banners, and synced ${syncedFromTimelines} timeline events.`,
    );
  } else {
    const rawBytes = fs.readFileSync(arg);
    const fileHash = createHash("sha256").update(rawBytes).digest("hex");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(rawBytes);

    const WEEKDAY_INDEX = {
      mon: 0, monday: 0,
      tue: 1, tuesday: 1,
      wed: 2, wednesday: 2,
      thu: 3, thursday: 3,
      fri: 4, friday: 4,
      sat: 5, saturday: 5,
      sun: 6, sunday: 6,
    };

    const events = new Map();
    const touchedMonths = new Set();

    for (const sheet of workbook.worksheets) {
      const match = sheet.name.trim().match(/^([A-Za-z]+)[\s_-]*(20\d{2}|\d{2})?$/);
      if (!match) continue;
      const month = SHEET_MONTH_MAP[match[1].toLowerCase()];
      if (!month) continue;
      const year = !match[2]
        ? new Date().getFullYear()
        : match[2].length === 2
          ? 2000 + Number(match[2])
          : Number(match[2]);
      const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
      touchedMonths.add(`${year}-${String(month).padStart(2, "0")}`);

      let headerRow = 0;
      const colWeekday = new Map();
      for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
        let matches = 0;
        const candidate = new Map();
        for (let c = 1; c <= sheet.columnCount; c++) {
          const txt = clean(sheet.getCell(r, c).value).toLowerCase();
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
        const cols = [...colWeekday.keys()].sort((a, b) => a - b);
        const firstCol = cols[0];
        if (firstCol && colWeekday.get(firstCol) === 1 && firstCol >= 2) {
          for (let c = 1; c < firstCol; c++) colWeekday.set(c, 0);
        }
        const lastCol = cols[cols.length - 1];
        if (lastCol && colWeekday.get(lastCol) === 6 && sheet.columnCount > lastCol) {
          colWeekday.set(lastCol + 1, 6);
        }
      }

      let weekDays = new Map();
      for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
        const rowCells = [];
        for (let col = 1; col <= sheet.columnCount; col++) {
          const text = clean(sheet.getCell(row, col).value);
          if (text) rowCells.push({ col, text });
        }
        if (rowCells.length === 0) {
          weekDays = new Map();
          continue;
        }

        const anchors = new Map();
        for (const { col, text } of rowCells) {
          const w = colWeekday.get(col) ?? (colWeekday.size === 0 ? Math.min(6, Math.floor((col - 1) / 2)) : undefined);
          if (w === undefined) continue;
          if (/^\d{1,2}$/.test(text)) {
            const d = Number(text);
            if (d >= 1 && d <= maxDays) {
              const actualW = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
              if (actualW === w && !anchors.has(w)) anchors.set(w, d);
            }
          } else if (!isNonEventBanner(text)) {
            const leadDay = text.match(/^(\d{1,2})\s+(?=[A-Za-z0-9])/);
            if (leadDay) {
              const d = Number(leadDay[1]);
              if (d >= 1 && d <= maxDays) {
                const actualW = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
                if (actualW === w && !anchors.has(w)) anchors.set(w, d);
              }
            }
          }
        }

        if (anchors.size > 0) {
          const [[anchorW, anchorDay]] = [...anchors.entries()];
          const nextWeek = new Map();
          for (let w = 0; w <= 6; w++) {
            const d = anchorDay + (w - anchorW);
            if (d >= 1 && d <= maxDays) nextWeek.set(w, d);
          }
          for (const [w, d] of anchors) nextWeek.set(w, d);
          weekDays = nextWeek;
        }
        if (weekDays.size === 0) continue;

        for (const { col, text: raw } of rowCells) {
          if (isNonEventBanner(raw)) continue;
          const w = colWeekday.get(col) ?? (colWeekday.size === 0 ? Math.min(6, Math.floor((col - 1) / 2)) : undefined);
          if (w === undefined) continue;
          const day = weekDays.get(w);
          if (!day || day < 1 || day > maxDays) continue;

          const timing = extractTiming(raw);
          const meta = extractMetadata(timing.cleanedText, day);
          if (isNonEventBanner(meta.title)) continue;

          const sourceKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}|${meta.title.trim().toLowerCase()}`;
          if (events.has(sourceKey)) continue;

          const start = makeTrinidadDate(year, month, day, timing.startHour, timing.startMinute);
          const end = makeTrinidadDate(year, month, day, timing.endHour, timing.endMinute);
          events.set(sourceKey, {
            sourceKey,
            title: meta.title,
            description: meta.description,
            event_type: classifyEventType(raw),
            start,
            end: end > start ? end : new Date(start.getTime() + 3600000),
            allDay: timing.allDay,
            location: meta.location,
            organiserId: meta.leadInitials ? byInitials.get(meta.leadInitials) ?? null : null,
          });
        }
      }
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let removed = 0;

    await db.begin(async (tx) => {
      for (const event of events.values()) {
        const { year, month, day } = trinidadParts(event.start);
        const dayStart = makeTrinidadDate(year, month, day, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        const existing = await tx`
          SELECT id, starts_at, ends_at, all_day, event_type, location, description, organiser_id, source
            FROM calendar_events
           WHERE source_key = ${event.sourceKey}
              OR (lower(title) = lower(${event.title}) AND starts_at >= ${dayStart} AND starts_at < ${dayEnd})
           LIMIT 1`;

        if (existing.length) {
          const row = existing[0];
          if (row.source === "MANUAL") {
            unchanged++;
            continue;
          }
          const hasChanges =
            row.starts_at.getTime() !== event.start.getTime() ||
            row.ends_at.getTime() !== event.end.getTime() ||
            row.all_day !== event.allDay ||
            row.event_type !== event.event_type ||
            (event.location && event.location !== row.location) ||
            (event.description && event.description !== row.description) ||
            (event.organiserId && event.organiserId !== row.organiser_id);

          if (hasChanges) {
            await tx`
              UPDATE calendar_events
                 SET title = ${event.title},
                     starts_at = ${event.start},
                     ends_at = ${event.end},
                     all_day = ${event.allDay},
                     event_type = ${event.event_type},
                     location = COALESCE(${event.location}, location),
                     description = COALESCE(${event.description}, description),
                     organiser_id = COALESCE(${event.organiserId}, organiser_id),
                     source = 'WORKBOOK',
                     source_key = ${event.sourceKey},
                     updated_at = now()
               WHERE id = ${row.id}`;
            updated++;
          } else {
            unchanged++;
          }
        } else {
          await tx`
            INSERT INTO calendar_events
              (title, description, event_type, starts_at, ends_at, all_day, location, organiser_id, source, source_key)
            VALUES
              (${event.title}, ${event.description}, ${event.event_type}, ${event.start}, ${event.end},
               ${event.allDay}, ${event.location}, ${event.organiserId}, 'WORKBOOK', ${event.sourceKey})`;
          inserted++;
        }
      }

      const wbRows = await tx`
        SELECT id, title, starts_at, source_key FROM calendar_events WHERE source = 'WORKBOOK'`;
      for (const row of wbRows) {
        const { dayKey } = trinidadParts(row.starts_at);
        const key = row.source_key ?? `${dayKey}|${row.title.trim().toLowerCase()}`;
        if (touchedMonths.has(key.slice(0, 7)) && !events.has(key)) {
          await tx`DELETE FROM calendar_events WHERE id = ${row.id}`;
          removed++;
        }
      }

      const summary = `Synced SharePoint workbook (${inserted} added, ${updated} updated, ${removed} removed)`;
      await tx`
        INSERT INTO calendar_sync_config
          (id, sharepoint_url, last_attempted_at, last_synced_at, last_file_hash,
           last_status, last_message, last_added, last_updated, last_removed, updated_at)
        VALUES
          (1, ${process.env.SHAREPOINT_CALENDAR_URL?.trim() || ""}, now(), now(), ${fileHash},
           'SYNCED', ${summary}, ${inserted}, ${updated}, ${removed}, now())
        ON CONFLICT (id) DO UPDATE
           SET last_attempted_at = now(),
               last_synced_at = now(),
               last_file_hash = EXCLUDED.last_file_hash,
               last_status = 'SYNCED',
               last_message = EXCLUDED.last_message,
               last_added = EXCLUDED.last_added,
               last_updated = EXCLUDED.last_updated,
               last_removed = EXCLUDED.last_removed,
               updated_at = now()`;

      await tx`
        INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
        VALUES (NULL, 'system (import-calendar script)', 'IMPORT', 'calendar_event', NULL,
                ${`${path.basename(arg)}: ${inserted} added, ${updated} updated, ${unchanged} unchanged, ${removed} removed`})`;
    });

    console.log(
      `Reconciled calendar workbook (${events.size} entries across ${touchedMonths.size} months): ${inserted} added, ${updated} updated, ${unchanged} unchanged, ${removed} removed.`,
    );
  }
} catch (error) {
  console.error("Calendar import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
