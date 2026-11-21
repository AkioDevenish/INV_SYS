"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import {
  DEFAULT_SHAREPOINT_CALENDAR_URL,
  isValidCalendarDate,
  makeTrinidadDate,
  parseCalendarFile,
  validateSharePointUrl,
} from "@/lib/calendar-import";
import {
  eventDayKeyInTrinidad,
  repairAndSyncCalendarEvents,
  runSharePointAutoSync,
  updateCalendarSyncSettings,
  upsertParsedEvents,
} from "@/lib/calendar-sync";
import { sql } from "@/lib/db";
import { assertPermission, type CurrentUser } from "@/lib/auth";

export type CalendarState = {
  error?: string;
  ok?: boolean;
  message?: string;
  needsAuth?: boolean;
  shareUrl?: string;
};

const MAX_CALENDAR_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const SAFE_USER_MESSAGES = [
  "You are not signed in.",
  "Your role does not allow this action.",
  "Password rotation required.",
  "Enter a valid SharePoint or OneDrive workbook URL.",
  "SharePoint URL must use https://.",
  "SharePoint URL cannot contain embedded credentials.",
  "URL must point to an official SharePoint or OneDrive host",
  "IP addresses are not permitted",
  "SharePoint host resolved to a restricted network address.",
  "Could not resolve SharePoint hostname.",
  "The CSV needs a Title column and a Start column.",
  "Could not recognise workbook layout.",
  "Only .ics, .csv and .xlsx files are supported.",
];

function safeCalendarError(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code;
  if (code === "23505") return "A matching calendar event already exists.";
  if (code === "23503") return "Selected organiser account does not exist.";
  if (code === "22008" || code === "22007") return "Invalid date or time value.";
  if (code === "22003") return "Numeric value out of range.";
  if (code === "23514") return "End time must be after the start time.";

  const msg = error instanceof Error ? error.message : "";
  if (msg && SAFE_USER_MESSAGES.some((prefix) => msg.startsWith(prefix))) {
    return msg;
  }

  console.error("[calendar/actions]", error);
  return fallback;
}

async function requireCalendarManager(): Promise<CurrentUser> {
  const user = await assertPermission("calendar.manage");
  if (user.mustChangePassword) {
    throw new Error("Password rotation required. Update your password before making changes.");
  }
  return user;
}

async function recordAuditTx(
  tx: postgres.TransactionSql,
  input: {
    user: CurrentUser;
    action: string;
    entity: string;
    entityId?: string | number | null;
    details?: string | null;
  },
): Promise<void> {
  await tx`
    INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
    VALUES (
      ${input.user.userId},
      ${`${input.user.name} (${input.user.email})`},
      ${input.action},
      ${input.entity},
      ${input.entityId == null ? null : String(input.entityId)},
      ${input.details ?? null}
    )`;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

function parseFormDateTime(raw: string, defaultHour: number): { date: Date; dateOnly: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { date: new Date(NaN), dateOnly: false };

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch.map(Number);
    if (!isValidCalendarDate(y, m, d)) return { date: new Date(NaN), dateOnly: true };
    return { date: makeTrinidadDate(y, m, d, defaultHour, 0), dateOnly: true };
  }

  const dtMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dtMatch) {
    const [, y, m, d, hh, mm, ss = 0] = dtMatch.map(Number);
    if (!isValidCalendarDate(y, m, d) || hh > 23 || mm > 59 || ss > 59) {
      return { date: new Date(NaN), dateOnly: false };
    }
    const iso = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}T${dtMatch[4]}:${dtMatch[5]}:${String(ss).padStart(2, "0")}-04:00`;
    return { date: new Date(iso), dateOnly: false };
  }

  return { date: new Date(trimmed), dateOnly: false };
}

function values(fd: FormData) {
  const title = text(fd, "title");
  const type = text(fd, "event_type") || "MEETING";
  const allDay = fd.get("all_day") === "on" || fd.get("all_day") === "true";
  const startsRaw = text(fd, "starts_at");
  const endsRaw = text(fd, "ends_at");

  const parsedStart = parseFormDateTime(startsRaw, 9);
  if (Number.isNaN(parsedStart.date.getTime())) {
    return { error: "Enter a valid start date and time." } as const;
  }

  let starts = parsedStart.date;
  let ends: Date;

  if (endsRaw) {
    const parsedEnd = parseFormDateTime(endsRaw, allDay ? 17 : 10);
    if (Number.isNaN(parsedEnd.date.getTime())) {
      return { error: "Enter a valid end date and time." } as const;
    }
    ends = parsedEnd.date;
  } else {
    ends = allDay
      ? new Date(starts.getTime() + 8 * 3600000)
      : new Date(starts.getTime() + 3600000);
  }

  if (allDay) {
    const startDay = eventDayKeyInTrinidad(starts);
    const endDay = eventDayKeyInTrinidad(ends);
    if (endDay < startDay || (!parsedStart.dateOnly && ends < starts)) {
      return { error: "End date must be on or after the start date." } as const;
    }
    // Normalize same-timestamp all-day inputs (e.g. 00:00..00:00) to 09:00..17:00 AST
    if (ends <= starts) {
      const [sy, sm, sd] = startDay.split("-").map(Number);
      const [ey, em, ed] = endDay.split("-").map(Number);
      starts = makeTrinidadDate(sy, sm, sd, 9, 0);
      ends = makeTrinidadDate(ey, em, ed, 17, 0);
    }
  }

  if (!title) return { error: "Add a title." } as const;
  if (title.length > 240) return { error: "Title must be 240 characters or fewer." } as const;
  if (!["MEETING", "MISSION", "LEAVE", "HOLIDAY", "DEADLINE", "OTHER"].includes(type)) {
    return { error: "Choose a valid event type." } as const;
  }
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
    return { error: "End time must be after the start time." } as const;
  }

  const organiserRaw = text(fd, "organiser_id");
  let organiserId: number | null = null;
  if (organiserRaw) {
    organiserId = parsePositiveInt(organiserRaw);
    if (!organiserId) return { error: "Choose a valid organiser." } as const;
  }

  return {
    title,
    type,
    starts,
    ends,
    allDay,
    location: text(fd, "location") || null,
    description: text(fd, "description") || null,
    organiserId,
  };
}

export async function createCalendarEventAction(
  _prev: CalendarState,
  fd: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const v = values(fd);
    if ("error" in v) return v;

    await sql.begin(async (tx) => {
      const [event] = await tx<{ id: number }[]>`
        INSERT INTO calendar_events
          (title, description, event_type, starts_at, ends_at, all_day, location, organiser_id, source)
        VALUES
          (${v.title}, ${v.description}, ${v.type}, ${v.starts}, ${v.ends}, ${v.allDay}, ${v.location}, ${v.organiserId}, 'MANUAL')
        RETURNING id`;
      await recordAuditTx(tx, {
        user,
        action: "CREATE",
        entity: "calendar_event",
        entityId: event.id,
        details: `${v.title} (${v.type})`,
      });
    });

    revalidatePath("/calendar");
    return { ok: true, message: "Event added to the shared calendar." };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not create the event.") };
  }
}

export async function updateCalendarEventAction(
  _prev: CalendarState,
  fd: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const id = parsePositiveInt(fd.get("id"));
    if (!id) return { error: "Missing or invalid event ID." };
    const v = values(fd);
    if ("error" in v) return v;

    const updated = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number }[]>`
        UPDATE calendar_events
           SET title = ${v.title},
               description = ${v.description},
               event_type = ${v.type},
               starts_at = ${v.starts},
               ends_at = ${v.ends},
               all_day = ${v.allDay},
               location = ${v.location},
               organiser_id = ${v.organiserId},
               updated_at = now()
         WHERE id = ${id}
         RETURNING id`;
      if (!row) return null;
      await recordAuditTx(tx, {
        user,
        action: "UPDATE",
        entity: "calendar_event",
        entityId: id,
        details: `${v.title} (${v.type})`,
      });
      return row;
    });

    if (!updated) return { error: "That calendar event no longer exists." };
    revalidatePath("/calendar");
    return { ok: true, message: "Event updated." };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not update the event.") };
  }
}

export async function deleteCalendarEventAction(
  prevOrFd: CalendarState | FormData,
  maybeFd?: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const fd = maybeFd instanceof FormData ? maybeFd : prevOrFd instanceof FormData ? prevOrFd : null;
    if (!fd) return { error: "Missing form payload." };

    const id = parsePositiveInt(fd.get("id"));
    if (!id) return { error: "Missing or invalid event ID." };

    const deleted = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number; title: string }[]>`
        DELETE FROM calendar_events WHERE id = ${id} RETURNING id, title`;
      if (!row) return null;
      await recordAuditTx(tx, {
        user,
        action: "DELETE",
        entity: "calendar_event",
        entityId: id,
        details: `Deleted calendar event: ${row.title}`,
      });
      return row;
    });

    if (!deleted) return { error: "That calendar event no longer exists." };
    revalidatePath("/calendar");
    return { ok: true, message: "Event removed from the calendar." };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not delete the event.") };
  }
}

export async function importCalendarAction(
  _prev: CalendarState,
  fd: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const file = fd.get("calendar_file");
    if (!(file instanceof File) || !file.size) {
      return { error: "Choose a calendar file (.xlsx, .ics, or .csv) to import." };
    }
    if (file.size > MAX_CALENDAR_UPLOAD_BYTES) {
      return { error: "Calendar file exceeds the 10 MB upload limit." };
    }

    const updateExisting = fd.get("update_existing") === "on";
    const pruneDeleted = fd.get("prune_deleted") === "on";
    const { events, skipped, format, sheetsRead, sheetMonths } = await parseCalendarFile(file);

    if (!events.length) {
      if (skipped.length) {
        const reasons = skipped
          .slice(0, 3)
          .map((s) => `${s.row}: ${s.reason}`)
          .join("; ");
        return {
          error: `No valid events could be imported (${skipped.length} skipped: ${reasons}${skipped.length > 3 ? "; …" : ""}).`,
        };
      }
      return { error: "No events found in that file." };
    }

    const { added, updated, duplicates, removed } = await upsertParsedEvents(
      events,
      user.userId,
      updateExisting,
      {
        sourceTag: "WORKBOOK",
        pruneMissingWorkbookEvents: pruneDeleted && format === "iica-grid",
        touchedMonths: format === "iica-grid" ? sheetMonths : undefined,
      },
    );

    const statusMsg = `${file.name}: ${added} added, ${updated} updated, ${removed} removed`;
    await sql`
      UPDATE calendar_sync_config
         SET last_attempted_at = now(),
             last_synced_at = now(),
             last_file_hash = NULL,
             last_status = 'SYNCED',
             last_message = ${statusMsg},
             last_added = ${added},
             last_updated = ${updated},
             last_removed = ${removed},
             updated_at = now()
       WHERE id = 1`;

    await sql`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (
        ${user.userId},
        ${`${user.name} (${user.email})`},
        'IMPORT',
        'calendar_event',
        NULL,
        ${`${file.name}: ${added} added, ${updated} updated, ${removed} removed, ${duplicates} unchanged, ${skipped.length} skipped`}
      )`;

    const parts = [`${added} new event${added === 1 ? "" : "s"} imported`];
    if (updated) parts.push(`${updated} updated`);
    if (removed) parts.push(`${removed} deleted/moved event${removed === 1 ? "" : "s"} cleaned up`);
    if (duplicates) parts.push(`${duplicates} unchanged`);
    if (sheetsRead?.length) {
      parts.push(
        `read ${sheetsRead.length} sheet${sheetsRead.length === 1 ? "" : "s"} (${
          format === "iica-grid" ? "IICA Team-TT monthly grid" : "tabular schedule"
        })`,
      );
    }
    if (skipped.length) {
      const reasons = skipped
        .slice(0, 3)
        .map((s) => `${s.row}: ${s.reason}`)
        .join("; ");
      parts.push(`${skipped.length} skipped (${reasons}${skipped.length > 3 ? "; …" : ""})`);
    }
    revalidatePath("/calendar");
    return { ok: true, message: `${parts.join(" · ")}.` };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not read that calendar file.") };
  }
}

export async function syncSharePointCalendarAction(
  _prev: CalendarState,
  fd: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const rawUrl = text(fd, "sharepoint_url") || DEFAULT_SHAREPOINT_CALENDAR_URL;
    const validatedUrl = (await validateSharePointUrl(rawUrl)).toString();
    const autoSyncEnabled = fd.get("auto_sync_enabled") === "on";
    const rawInterval = Number(fd.get("sync_interval_minutes") || 15);
    const clampedInterval = Number.isFinite(rawInterval)
      ? Math.max(1, Math.min(1440, Math.round(rawInterval)))
      : 15;
    const pruneDeleted = fd.get("prune_deleted") === "on";

    await updateCalendarSyncSettings({
      sharepointUrl: validatedUrl,
      autoSyncEnabled,
      syncIntervalMinutes: clampedInterval,
      pruneDeleted,
    });

    const result = await runSharePointAutoSync({
      force: true,
      overrideUrl: validatedUrl,
      userId: user.userId,
    });

    if (!result.ok) {
      revalidatePath("/calendar");
      return {
        error: result.message,
        needsAuth: result.needsAuth,
        shareUrl: validatedUrl,
      };
    }

    await sql`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (
        ${user.userId},
        ${`${user.name} (${user.email})`},
        'IMPORT',
        'calendar_event',
        NULL,
        ${`SharePoint sync: ${result.message}`}
      )`;

    revalidatePath("/calendar");
    return {
      ok: true,
      message: `Auto-sync saved (every ${clampedInterval} min). ${result.message}`,
    };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not sync from SharePoint.") };
  }
}

export async function syncTimelinesToCalendarAction(
  _prev: CalendarState,
  _fd?: FormData,
): Promise<CalendarState> {
  try {
    const user = await requireCalendarManager();
    const { repaired, syncedFromTimelines } = await repairAndSyncCalendarEvents(user.userId);

    await sql`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (
        ${user.userId},
        ${`${user.name} (${user.email})`},
        'IMPORT',
        'calendar_event',
        NULL,
        ${`Timelines sync: ${syncedFromTimelines} timeline activities synced, ${repaired} workbook keys verified`}
      )`;

    revalidatePath("/calendar");
    return {
      ok: true,
      message: `Synced ${syncedFromTimelines} dated activity${syncedFromTimelines === 1 ? "" : "ies"} from Timelines.`,
    };
  } catch (error) {
    return { error: safeCalendarError(error, "Could not sync timelines to calendar.") };
  }
}
