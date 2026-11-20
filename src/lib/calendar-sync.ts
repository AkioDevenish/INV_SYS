import "server-only";
import { sql } from "./db";
import {
  classifyEventType,
  DEFAULT_SHAREPOINT_CALENDAR_URL,
  extractTimingFromText,
  fetchAndParseSharePointWorkbook,
  isValidCalendarDate,
  makeTrinidadDate,
  type ParsedEvent,
} from "./calendar-import";

export function getCalendarWebhookSecret(): string | undefined {
  const secret = process.env.CALENDAR_SYNC_SECRET?.trim();
  if (!secret) return undefined;
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    return undefined;
  }
  return secret;
}

export type CalendarSyncConfigRow = {
  id: number;
  sharepoint_url: string;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  prune_deleted: boolean;
  last_attempted_at: Date | null;
  last_synced_at: Date | null;
  last_file_hash: string | null;
  last_status: string;
  last_message: string | null;
  last_added: number;
  last_updated: number;
  last_removed: number;
  updated_at: Date;
};

const INITIALS_ALIASES: Record<string, string> = {
  DEF: "Diana Francis",
  DF: "Diana Francis",
  LH: "Lisa Harrynanan",
  RR: "Richard Rampersaud",
  MA: "Mercedes Archer",
  JL: "Junnel Lewis",
  GH: "Geselle Hodge",
  GEH: "Geselle Hodge",
  SE: "Salisha Estrada",
  VAB: "Veronica Alleyne-Bailey",
  VB: "Veronica Alleyne-Bailey",
  EF: "Edwin Franco",
  AD: "Akio Devenish",
  EC: "Earllene Crawford",
};

let schemaEnsured = false;

export async function ensureCalendarSyncSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    const [row] = await sql<{ id: number }[]>`
      SELECT id FROM calendar_sync_config WHERE id = 1`;
    if (!row) {
      await sql`
        INSERT INTO calendar_sync_config (id, sharepoint_url, auto_sync_enabled, sync_interval_minutes, prune_deleted, last_status, last_message)
        VALUES (1, ${DEFAULT_SHAREPOINT_CALENDAR_URL}, true, 15, true, 'READY', 'Auto-sync active')
        ON CONFLICT (id) DO NOTHING`;
    }
    schemaEnsured = true;
  } catch (err) {
    // Fallback only if table has not been created by setup/seed yet
    const code = (err as { code?: string })?.code;
    if (code !== "42P01") throw err;
    await sql`
      CREATE TABLE IF NOT EXISTS calendar_sync_config (
        id                    INTEGER PRIMARY KEY DEFAULT 1,
        sharepoint_url        TEXT NOT NULL,
        auto_sync_enabled     BOOLEAN NOT NULL DEFAULT true,
        sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
        prune_deleted         BOOLEAN NOT NULL DEFAULT true,
        last_attempted_at     TIMESTAMPTZ,
        last_synced_at        TIMESTAMPTZ,
        last_file_hash        TEXT,
        last_status           TEXT NOT NULL DEFAULT 'READY',
        last_message          TEXT,
        last_added            INTEGER NOT NULL DEFAULT 0,
        last_updated          INTEGER NOT NULL DEFAULT 0,
        last_removed          INTEGER NOT NULL DEFAULT 0,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`
      INSERT INTO calendar_sync_config (id, sharepoint_url, auto_sync_enabled, sync_interval_minutes, prune_deleted, last_status, last_message)
      VALUES (1, ${DEFAULT_SHAREPOINT_CALENDAR_URL}, true, 15, true, 'READY', 'Auto-sync active')
      ON CONFLICT (id) DO NOTHING`;
    schemaEnsured = true;
  }
}

export async function getCalendarSyncConfig(): Promise<CalendarSyncConfigRow> {
  await ensureCalendarSyncSchema();
  const [row] = await sql<CalendarSyncConfigRow[]>`
    SELECT * FROM calendar_sync_config WHERE id = 1`;
  return row;
}

export async function updateCalendarSyncSettings(settings: {
  sharepointUrl: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  pruneDeleted: boolean;
  resetFileHash?: boolean;
}): Promise<CalendarSyncConfigRow> {
  await ensureCalendarSyncSchema();
  const interval = Math.max(1, Math.min(1440, Math.round(settings.syncIntervalMinutes || 15)));
  const [row] = await sql<CalendarSyncConfigRow[]>`
    UPDATE calendar_sync_config
       SET sharepoint_url = ${settings.sharepointUrl},
           auto_sync_enabled = ${settings.autoSyncEnabled},
           sync_interval_minutes = ${interval},
           prune_deleted = ${settings.pruneDeleted},
           last_file_hash = CASE
             WHEN ${Boolean(settings.resetFileHash)} OR sharepoint_url <> ${settings.sharepointUrl} THEN NULL
             ELSE last_file_hash
           END,
           updated_at = now()
     WHERE id = 1
     RETURNING *`;
  return row;
}

export async function loadInitialsToUserIdMap(): Promise<Map<string, number>> {
  const users = await sql<{ id: number; name: string }[]>`
    SELECT id, name FROM users WHERE status = 'ACTIVE' ORDER BY id`;
  const byInitials = new Map<string, number>();

  for (const user of users) {
    const ini = user.name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    if (ini && !byInitials.has(ini)) {
      byInitials.set(ini, user.id);
    }
  }

  for (const [alias, fullName] of Object.entries(INITIALS_ALIASES)) {
    const match = users.find((u) => u.name.toLowerCase() === fullName.toLowerCase());
    if (match) {
      byInitials.set(alias.toUpperCase(), match.id);
    }
  }

  return byInitials;
}

export function eventDayKeyInTrinidad(d: Date): string {
  const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function eventTimeKeyInTrinidad(d: Date): string {
  const shifted = new Date(d.getTime() - 4 * 3600 * 1000);
  return shifted.toISOString().slice(11, 16);
}

export function makeSourceKey(event: ParsedEvent): string {
  if (event.sourceKey) return event.sourceKey;
  const dayKey = eventDayKeyInTrinidad(event.start);
  return `${dayKey}|${event.title.trim().toLowerCase()}`;
}

type ExistingCalendarRow = {
  id: number;
  title: string;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  event_type: string;
  location: string | null;
  description: string | null;
  organiser_id: number | null;
  source: string;
  source_key: string | null;
};

/**
 * Full transactional reconciliation for a workbook, file, or timeline sync:
 * - Acquires an advisory lock inside `sql.begin` so concurrent syncs never race
 * - Preserves `MANUAL` events untouched (never hijacks or deletes them)
 * - Uses Trinidad AST (`UTC-4`) day keys for matching and pruning
 * - Updates changed titles, times, types, locations, descriptions, and organisers
 */
export async function upsertParsedEvents(
  events: ParsedEvent[],
  fallbackUserId: number | null,
  replaceExistingOnSameDay = true,
  options: {
    sourceTag?: "WORKBOOK" | "TIMELINES" | "MANUAL";
    pruneMissingWorkbookEvents?: boolean;
    pruneMissingTimelineEvents?: boolean;
    touchedMonths?: string[];
  } = {},
): Promise<{ added: number; updated: number; duplicates: number; removed: number }> {
  await ensureCalendarSyncSchema();
  const byInitials = await loadInitialsToUserIdMap();
  const sourceTag = options.sourceTag ?? "WORKBOOK";

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(9261042)`;

    const allRows = await tx<ExistingCalendarRow[]>`
      SELECT id, title, starts_at, ends_at, all_day, event_type,
             location, description, organiser_id, source, source_key
        FROM calendar_events`;

    const existingRows = allRows.filter((r) => r.source !== "MANUAL");
    const occupiedSourceKeys = new Map<string, number>();
    for (const row of allRows) {
      if (row.source_key && !occupiedSourceKeys.has(row.source_key)) {
        occupiedSourceKeys.set(row.source_key, row.id);
      }
    }

    const bySourceKey = new Map<string, ExistingCalendarRow[]>();
    const byLegacyKey = new Map<string, ExistingCalendarRow[]>();

    for (const row of existingRows) {
      if (row.source_key) {
        const sk = `${row.source}|${row.source_key}`;
        const list = bySourceKey.get(sk) ?? [];
        list.push(row);
        bySourceKey.set(sk, list);
      }
      const legacy = `${eventDayKeyInTrinidad(row.starts_at)}|${row.title.trim().toLowerCase()}`;
      const lk = `${row.source}|${legacy}`;
      const list = byLegacyKey.get(lk) ?? [];
      list.push(row);
      byLegacyKey.set(lk, list);
    }

    const usedIds = new Set<number>();
    const usedKeysInBatch = new Map<string, number>();
    const incomingSourceKeys = new Set<string>();
    const touchedMonths = new Set<string>(options.touchedMonths ?? []);

    type PlannedItem = {
      event: ParsedEvent;
      sourceKey: string;
      organiserId: number | null;
      matched?: ExistingCalendarRow;
    };
    const planned: PlannedItem[] = [];

    for (const event of events) {
      const dayKey = eventDayKeyInTrinidad(event.start);
      touchedMonths.add(dayKey.slice(0, 7));

      let sourceKey = makeSourceKey(event);
      const seenCount = usedKeysInBatch.get(sourceKey) ?? 0;
      usedKeysInBatch.set(sourceKey, seenCount + 1);
      if (seenCount > 0 && !event.sourceKey) {
        const timeTag = event.allDay
          ? `slot${seenCount + 1}`
          : `${eventTimeKeyInTrinidad(event.start)}#${seenCount + 1}`;
        sourceKey = `${sourceKey}@${timeTag}`;
      }
      incomingSourceKeys.add(sourceKey);

      const organiserId =
        event.organiserId !== undefined
          ? event.organiserId
          : (event.leadInitials ? byInitials.get(event.leadInitials.toUpperCase()) : undefined) ??
            fallbackUserId;

      const sourceMatches = bySourceKey.get(`${sourceTag}|${sourceKey}`) ?? [];
      let matched = sourceMatches.find((c) => !usedIds.has(c.id));

      if (!matched && seenCount === 0) {
        const legacyLookup = `${dayKey}|${event.title.trim().toLowerCase()}`;
        const candidates = byLegacyKey.get(`${sourceTag}|${legacyLookup}`) ?? [];
        matched = candidates.find((c) => !usedIds.has(c.id));
      }

      if (matched) usedIds.add(matched.id);
      planned.push({ event, sourceKey, organiserId, matched });
    }

    let added = 0;
    let updated = 0;
    let duplicates = 0;
    let removed = 0;

    // Prune stale rows FIRST so freed source_key values do not collide with inserts/updates
    if (options.pruneMissingWorkbookEvents && sourceTag === "WORKBOOK" && touchedMonths.size > 0) {
      for (const row of existingRows) {
        if (row.source !== "WORKBOOK" || usedIds.has(row.id)) continue;
        const ym = eventDayKeyInTrinidad(row.starts_at).slice(0, 7);
        const key =
          row.source_key ??
          `${eventDayKeyInTrinidad(row.starts_at)}|${row.title.trim().toLowerCase()}`;
        if (touchedMonths.has(ym) && !incomingSourceKeys.has(key)) {
          await tx`DELETE FROM calendar_events WHERE id = ${row.id}`;
          if (row.source_key && occupiedSourceKeys.get(row.source_key) === row.id) {
            occupiedSourceKeys.delete(row.source_key);
          }
          removed++;
        }
      }
    }

    if (options.pruneMissingTimelineEvents && sourceTag === "TIMELINES") {
      for (const row of existingRows) {
        if (row.source !== "TIMELINES" || usedIds.has(row.id)) continue;
        const key =
          row.source_key ??
          `${eventDayKeyInTrinidad(row.starts_at)}|${row.title.trim().toLowerCase()}`;
        if (!incomingSourceKeys.has(key)) {
          await tx`DELETE FROM calendar_events WHERE id = ${row.id}`;
          if (row.source_key && occupiedSourceKeys.get(row.source_key) === row.id) {
            occupiedSourceKeys.delete(row.source_key);
          }
          removed++;
        }
      }
    }

    const claimUniqueSourceKey = (desired: string, currentRowId?: number): string => {
      let candidate = desired;
      let suffix = 1;
      while (occupiedSourceKeys.has(candidate) && occupiedSourceKeys.get(candidate) !== currentRowId) {
        candidate = suffix === 1 ? `${desired}::${sourceTag.toLowerCase()}` : `${desired}::${sourceTag.toLowerCase()}-${suffix}`;
        suffix++;
      }
      occupiedSourceKeys.set(candidate, currentRowId ?? -1);
      return candidate;
    };

    for (const item of planned) {
      const { event, organiserId, matched } = item;
      const safeKey = claimUniqueSourceKey(item.sourceKey, matched?.id);

      if (matched) {
        if (matched.source_key && matched.source_key !== safeKey && occupiedSourceKeys.get(matched.source_key) === matched.id) {
          occupiedSourceKeys.delete(matched.source_key);
        }

        const hasChanges =
          matched.title !== event.title ||
          matched.starts_at.getTime() !== event.start.getTime() ||
          matched.ends_at.getTime() !== event.end.getTime() ||
          matched.all_day !== event.allDay ||
          matched.event_type !== event.eventType ||
          (matched.location ?? null) !== (event.location ?? null) ||
          (matched.description ?? null) !== (event.description ?? null) ||
          (organiserId !== null && matched.organiser_id !== organiserId);

        if (replaceExistingOnSameDay && hasChanges) {
          await tx`
            UPDATE calendar_events
               SET title = ${event.title},
                   starts_at = ${event.start},
                   ends_at = ${event.end},
                   all_day = ${event.allDay},
                   event_type = ${event.eventType},
                   location = ${event.location},
                   description = ${event.description},
                   organiser_id = ${organiserId ?? matched.organiser_id},
                   source = ${sourceTag},
                   source_key = ${safeKey},
                   updated_at = now()
             WHERE id = ${matched.id}`;
          updated++;
        } else {
          if (matched.source_key !== safeKey) {
            await tx`
              UPDATE calendar_events
                 SET source_key = ${safeKey}
               WHERE id = ${matched.id}`;
          }
          duplicates++;
        }
        continue;
      }

      await tx`
        INSERT INTO calendar_events
          (title, description, event_type, starts_at, ends_at, all_day, location, organiser_id, source, source_key)
        VALUES
          (${event.title}, ${event.description}, ${event.eventType}, ${event.start},
           ${event.end}, ${event.allDay}, ${event.location}, ${organiserId}, ${sourceTag}, ${safeKey})`;
      added++;
    }

    return { added, updated, duplicates, removed };
  });
}

/**
 * Checks whether the automatic sync interval has elapsed (or `force = true`),
 * atomically claims the run, pulls the SharePoint workbook if reachable, compares
 * its SHA-256 hash, and reconciles any added, updated or deleted rows.
 */
export async function runSharePointAutoSync(options: {
  force?: boolean;
  overrideUrl?: string;
  userId?: number | null;
} = {}): Promise<{
  ran: boolean;
  ok: boolean;
  unchanged?: boolean;
  needsAuth?: boolean;
  message: string;
  config: CalendarSyncConfigRow;
}> {
  await ensureCalendarSyncSchema();

  const claim = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(9261043)`;
    const [config] = await tx<CalendarSyncConfigRow[]>`
      SELECT * FROM calendar_sync_config WHERE id = 1`;
    const targetUrl = options.overrideUrl?.trim() || config.sharepoint_url;

    // Coalesce concurrent requests if another worker is actively syncing (< 2 min old)
    if (
      config.last_status === "SYNCING" &&
      config.last_attempted_at &&
      Date.now() - new Date(config.last_attempted_at).getTime() < 120_000
    ) {
      return { proceed: false as const, reason: "Sync already in progress.", config, targetUrl };
    }

    if (!options.force) {
      if (!config.auto_sync_enabled) {
        return { proceed: false as const, reason: "Auto-sync is paused.", config, targetUrl };
      }
      if (config.last_attempted_at) {
        const elapsedMs = Date.now() - new Date(config.last_attempted_at).getTime();
        const intervalMs = Math.max(1, config.sync_interval_minutes) * 60 * 1000;
        if (elapsedMs < intervalMs) {
          return { proceed: false as const, reason: "Within sync interval.", config, targetUrl };
        }
      }
    }

    const [claimedConfig] = await tx<CalendarSyncConfigRow[]>`
      UPDATE calendar_sync_config
         SET last_attempted_at = now(),
             last_status = 'SYNCING',
             updated_at = now()
       WHERE id = 1
       RETURNING *`;
    return { proceed: true as const, config: claimedConfig, prevConfig: config, targetUrl };
  });

  if (!claim.proceed) {
    return { ran: false, ok: true, message: claim.reason, config: claim.config };
  }

  const prevConfig = claim.prevConfig;
  const sameUrl = claim.targetUrl === prevConfig.sharepoint_url;
  const compareHash = options.force || !sameUrl ? null : prevConfig.last_file_hash;

  const fetched = await fetchAndParseSharePointWorkbook(claim.targetUrl, compareHash);

  if (!fetched.ok) {
    const [updatedConfig] = await sql<CalendarSyncConfigRow[]>`
      UPDATE calendar_sync_config
         SET sharepoint_url = ${claim.targetUrl},
             last_attempted_at = now(),
             last_status = ${fetched.needsAuth ? "AUTH_REQUIRED" : "ERROR"},
             last_message = ${fetched.error},
             updated_at = now()
       WHERE id = 1
       RETURNING *`;
    return {
      ran: true,
      ok: false,
      needsAuth: fetched.needsAuth,
      message: fetched.error,
      config: updatedConfig,
    };
  }

  if (fetched.unchanged) {
    const [updatedConfig] = await sql<CalendarSyncConfigRow[]>`
      UPDATE calendar_sync_config
         SET sharepoint_url = ${claim.targetUrl},
             last_attempted_at = now(),
             last_synced_at = now(),
             last_status = 'SYNCED',
             last_message = 'Workbook is up to date (no changes detected).',
             last_added = 0,
             last_updated = 0,
             last_removed = 0,
             updated_at = now()
       WHERE id = 1
       RETURNING *`;
    return {
      ran: true,
      ok: true,
      unchanged: true,
      message: "Workbook is up to date (no changes detected).",
      config: updatedConfig,
    };
  }

  const { events, sheetsRead, sheetMonths, format } = fetched.result;
  const { added, updated, removed } = await upsertParsedEvents(
    events,
    options.userId ?? null,
    true,
    {
      sourceTag: "WORKBOOK",
      pruneMissingWorkbookEvents: prevConfig.prune_deleted && format === "iica-grid",
      touchedMonths: sheetMonths,
    },
  );

  const summary = `Synced ${sheetsRead?.length ?? 1} sheets (${added} added, ${updated} updated, ${removed} removed)`;
  const [updatedConfig] = await sql<CalendarSyncConfigRow[]>`
    UPDATE calendar_sync_config
       SET sharepoint_url = ${claim.targetUrl},
           last_attempted_at = now(),
           last_synced_at = now(),
           last_file_hash = ${fetched.fileHash},
           last_status = 'SYNCED',
           last_message = ${summary},
           last_added = ${added},
           last_updated = ${updated},
           last_removed = ${removed},
           updated_at = now()
     WHERE id = 1
     RETURNING *`;

  return {
    ran: true,
    ok: true,
    unchanged: false,
    message: summary,
    config: updatedConfig,
  };
}

/**
 * Syncs dated activities and monthly schedules from `staff_tasks` into `calendar_events`
 * without mutating `staff_tasks` or touching `MANUAL` events.
 */
export async function repairAndSyncCalendarEvents(fallbackUserId: number | null = null): Promise<{
  repaired: number;
  removedBanners: number;
  syncedFromTimelines: number;
}> {
  await ensureCalendarSyncSchema();

  // Backfill missing source_key on existing WORKBOOK rows using Trinidad AST dates (never mutate MANUAL)
  const missingWorkbookKeys = await sql<{ id: number; title: string; starts_at: Date }[]>`
    SELECT id, title, starts_at
      FROM calendar_events
     WHERE source = 'WORKBOOK' AND source_key IS NULL`;

  let repaired = 0;
  for (const row of missingWorkbookKeys) {
    const sourceKey = `${eventDayKeyInTrinidad(row.starts_at)}|${row.title.trim().toLowerCase()}`;
    await sql`
      UPDATE calendar_events
         SET source_key = ${sourceKey},
             updated_at = now()
       WHERE id = ${row.id}`;
    repaired++;
  }

  const tasks = await sql<{
    id: number;
    area: string;
    title: string;
    lead: string | null;
    origin: string | null;
    starts_on: Date | null;
    ends_on: Date | null;
    schedule_note: string | null;
    comments: string | null;
    owner_id: number | null;
    status: string;
  }[]>`
    SELECT id, area, title, lead, origin, starts_on, ends_on, schedule_note, comments, owner_id, status
      FROM staff_tasks`;

  const timelineEvents: ParsedEvent[] = [];
  const monthLookup: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const currentTrinidadYear = new Date(Date.now() - 4 * 3600 * 1000).getUTCFullYear();

  for (const task of tasks) {
    const firstLead = task.lead?.split(/[/,&]/)[0]?.trim().toUpperCase() || null;
    const statusLabel = task.status.replaceAll("_", " ").toLowerCase();
    const descParts = [
      `Timeline Area: ${task.area}`,
      `Status: ${statusLabel}`,
      task.lead ? `Lead: ${task.lead}` : null,
      task.origin ? `Origin: ${task.origin}` : null,
      task.schedule_note ? `Schedule: ${task.schedule_note}` : null,
      task.comments ? `Notes: ${task.comments}` : null,
    ].filter(Boolean);
    const description = descParts.join(" · ");
    const eventType = classifyEventType(
      task.title,
      /report\s+prep|payments|request\s+for\s+cash|concept\s+note|sugi/i.test(task.title)
        ? "DEADLINE"
        : undefined,
    );

    const timing = task.schedule_note ? extractTimingFromText(task.schedule_note) : null;
    const explicitOwner = task.owner_id ?? undefined;

    if (task.starts_on || task.ends_on) {
      const startDay = task.starts_on ?? task.ends_on!;
      const endDayRaw = task.ends_on ?? task.starts_on!;
      const endDay = endDayRaw >= startDay ? endDayRaw : startDay;
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
        : makeTrinidadDate(y1, m1, d1, timing!.startHour, timing!.startMinute);
      const end = isMultiDay
        ? makeTrinidadDate(y2, m2, d2, 17, 0)
        : allDay
          ? makeTrinidadDate(y1, m1, d1, 17, 0)
          : makeTrinidadDate(y1, m1, d1, timing!.endHour, timing!.endMinute);

      const occKey = `${y1}-${String(m1).padStart(2, "0")}-${String(d1).padStart(2, "0")}`;
      timelineEvents.push({
        title: task.title,
        start,
        end: end > start ? end : new Date(start.getTime() + 3600000),
        allDay,
        location: /\bin\s+person\b/i.test(task.title)
          ? "In Person"
          : /\bwebinar\b/i.test(task.title)
            ? "Zoom / Virtual"
            : null,
        description,
        eventType,
        leadInitials: firstLead,
        organiserId: explicitOwner,
        sourceKey: `timeline:${task.id}:${occKey}`,
      });
      continue;
    }

    if (task.schedule_note) {
      const explicitYearMatch = task.schedule_note.match(/\b(20\d{2})\b/);
      const noteYear = explicitYearMatch ? Number(explicitYearMatch[1]) : currentTrinidadYear;
      const segments = task.schedule_note.split(/[·;]/);
      let currentMonth: number | null = null;
      let occIdx = 0;

      for (const seg of segments) {
        // Strip em-dash notes and embedded time ranges so "Sep 5 - 10:00am" isn't read as days 5..10
        const cleanSeg = seg
          .split("—")[0]
          .replace(/\b\d{1,2}(?::\d{2})?\s*(?:-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|noon)\b/gi, " ")
          .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|noon)\b/gi, " ")
          .trim();

        const mMatch = cleanSeg.match(
          /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
        );
        if (mMatch) {
          currentMonth = monthLookup[mMatch[1].slice(0, 3).toLowerCase()] ?? null;
        }
        if (!currentMonth) continue;
        if (/\b(na|tbc|ongoing)\b/i.test(cleanSeg)) continue;

        // Only accept day-number ranges after stripping times & month labels
        const afterMonth = mMatch ? cleanSeg.slice((mMatch.index ?? 0) + mMatch[0].length) : cleanSeg;
        const rangeDayMatch = afterMonth.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})(?!\s*:)\b/);
        if (rangeDayMatch) {
          const dStart = Number(rangeDayMatch[1]);
          const dEnd = Number(rangeDayMatch[2]);
          if (
            isValidCalendarDate(noteYear, currentMonth, dStart) &&
            isValidCalendarDate(noteYear, currentMonth, dEnd) &&
            dEnd >= dStart
          ) {
            occIdx++;
            const occKey = `${noteYear}-${String(currentMonth).padStart(2, "0")}-${String(dStart).padStart(2, "0")}-${occIdx}`;
            timelineEvents.push({
              title: task.title,
              start: makeTrinidadDate(noteYear, currentMonth, dStart, 9, 0),
              end: makeTrinidadDate(noteYear, currentMonth, dEnd, 17, 0),
              allDay: true,
              location: null,
              description,
              eventType,
              leadInitials: firstLead,
              organiserId: explicitOwner,
              sourceKey: `timeline:${task.id}:${occKey}`,
            });
            continue;
          }
        }

        const dayNumbers = [...afterMonth.matchAll(/\b(\d{1,2})\b(?!\s*:)/g)].map((m) => Number(m[1]));
        for (const dayNum of dayNumbers) {
          if (!isValidCalendarDate(noteYear, currentMonth, dayNum)) continue;
          occIdx++;
          const hasTime = timing && !timing.allDay;
          const start = hasTime
            ? makeTrinidadDate(noteYear, currentMonth, dayNum, timing!.startHour, timing!.startMinute)
            : makeTrinidadDate(noteYear, currentMonth, dayNum, 9, 0);
          const end = hasTime
            ? makeTrinidadDate(noteYear, currentMonth, dayNum, timing!.endHour, timing!.endMinute)
            : makeTrinidadDate(noteYear, currentMonth, dayNum, 17, 0);

          const occKey = `${noteYear}-${String(currentMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}-${occIdx}`;
          timelineEvents.push({
            title: task.title,
            start,
            end: end > start ? end : new Date(start.getTime() + 3600000),
            allDay: !hasTime,
            location: null,
            description,
            eventType,
            leadInitials: firstLead,
            organiserId: explicitOwner,
            sourceKey: `timeline:${task.id}:${occKey}`,
          });
        }
      }
    }
  }

  const synced = await upsertParsedEvents(timelineEvents, fallbackUserId, true, {
    sourceTag: "TIMELINES",
    pruneMissingTimelineEvents: true,
  });

  return {
    repaired,
    removedBanners: 0,
    syncedFromTimelines: synced.added + synced.updated,
  };
}
