"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { assertPermission, recordAudit } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  isPriority,
  isTaskStatus,
  isValidIsoDate,
  syncStatusAndProgress,
  type TaskStatus,
} from "@/lib/timelines";
import { parseTimelineWorkbook } from "@/lib/timeline-import";

export type TaskState = { error?: string; ok?: boolean; message?: string };

const MAX_TIMELINE_UPLOAD_BYTES = 10 * 1024 * 1024;

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

function parseOptionalDate(fd: FormData, key: string): { value: string | null } | { error: string } {
  const raw = text(fd, key);
  if (!raw) return { value: null };
  if (!isValidIsoDate(raw)) return { error: "Enter a valid calendar date (YYYY-MM-DD)." };
  return { value: raw };
}

function progressOrNull(fd: FormData): number | null {
  const raw = text(fd, "progress");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeTaskError(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code;
  if (code === "23503") return "The selected assignee no longer exists.";
  if (code === "22007" || code === "22008") return "Invalid date provided.";
  if (code === "22P02" || code === "22003") return "Invalid identifier provided.";
  console.error("Timelines action error:", error);
  return fallback;
}

export async function saveTaskAction(_prev: TaskState, fd: FormData): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.manage");
    const rawId = text(fd, "id");
    const id = rawId ? parsePositiveInt(rawId) : null;
    if (rawId && !id) return { error: "Invalid task ID." };

    const title = text(fd, "title");
    if (!title) return { error: "The task needs a title." };
    const area = text(fd, "area") || "General";

    const startsCheck = parseOptionalDate(fd, "starts_on");
    if ("error" in startsCheck) return { error: startsCheck.error };
    const endsCheck = parseOptionalDate(fd, "ends_on");
    if ("error" in endsCheck) return { error: endsCheck.error };
    if (startsCheck.value && endsCheck.value && endsCheck.value < startsCheck.value) {
      return { error: "Due date cannot be before start date." };
    }

    const rawOwnerId = text(fd, "owner_id");
    let ownerId: number | null = null;
    if (rawOwnerId) {
      ownerId = parsePositiveInt(rawOwnerId);
      if (!ownerId) return { error: "Invalid accountable person selected." };
      const [ownerExists] = await sql<{ id: number }[]>`
        SELECT id FROM users WHERE id = ${ownerId} LIMIT 1`;
      if (!ownerExists) return { error: "The selected accountable person no longer exists." };
    }

    const priorityRaw = text(fd, "priority").toUpperCase();
    const statusRaw = text(fd, "status").toUpperCase();
    const rawStatus: TaskStatus = isTaskStatus(statusRaw) ? statusRaw : "NOT_STARTED";
    const synced = syncStatusAndProgress(rawStatus, progressOrNull(fd));

    const values = {
      area,
      title,
      lead: text(fd, "lead") || null,
      origin: text(fd, "origin") || null,
      priority: isPriority(priorityRaw) ? priorityRaw : "M",
      status: synced.status,
      progress: synced.progress,
      starts_on: startsCheck.value,
      ends_on: endsCheck.value,
      schedule_note: text(fd, "schedule_note") || null,
      owner_id: ownerId,
      comments: text(fd, "comments") || null,
    };

    if (id) {
      const [existing] = await sql<{ progress: number | null }[]>`
        SELECT progress FROM staff_tasks WHERE id = ${id}`;
      if (!existing) return { error: "That task no longer exists." };
      const progressChanged = existing.progress !== values.progress;

      const [updated] = await sql<{ id: number }[]>`
        UPDATE staff_tasks SET
          area = ${values.area}, title = ${values.title}, lead = ${values.lead},
          origin = ${values.origin}, priority = ${values.priority}, status = ${values.status},
          progress = ${values.progress}, starts_on = ${values.starts_on},
          owner_id = ${values.owner_id},
          ends_on = ${values.ends_on}, schedule_note = ${values.schedule_note},
          comments = ${values.comments},
          progress_updated_at = CASE WHEN ${progressChanged} THEN now() ELSE progress_updated_at END,
          progress_updated_by = CASE WHEN ${progressChanged} THEN ${user.userId} ELSE progress_updated_by END,
          updated_at = now()
        WHERE id = ${id}
        RETURNING id`;
      if (!updated) return { error: "That task no longer exists." };
      await recordAudit({ user, action: "UPDATE", entity: "staff_task", entityId: id, details: title });
    } else {
      const hasProgress = values.progress !== null;
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO staff_tasks (area, title, lead, origin, priority, status, progress,
                                 starts_on, ends_on, schedule_note, comments, owner_id,
                                 progress_updated_at, progress_updated_by)
        VALUES (${values.area}, ${values.title}, ${values.lead}, ${values.origin},
                ${values.priority}, ${values.status}, ${values.progress}, ${values.starts_on},
                ${values.ends_on}, ${values.schedule_note}, ${values.comments}, ${values.owner_id},
                ${hasProgress ? sql`now()` : null}, ${hasProgress ? user.userId : null})
        RETURNING id`;
      await recordAudit({ user, action: "CREATE", entity: "staff_task", entityId: row.id, details: title });
    }

    revalidatePath("/timelines");
    return { ok: true };
  } catch (error) {
    return { error: safeTaskError(error, "Could not save that task.") };
  }
}

export async function deleteTaskAction(_prev: TaskState, fd: FormData): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.manage");
    const id = parsePositiveInt(fd.get("id"));
    if (!id) return { error: "Nothing selected." };

    const deleted = await sql.begin(async (tx) => {
      const [row] = await tx<{ title: string }[]>`
        DELETE FROM staff_tasks WHERE id = ${id} RETURNING title`;
      if (!row) return null;
      await tx`
        DELETE FROM calendar_events
        WHERE source = 'TIMELINES'
          AND (source_key = ${String(id)} OR source_key LIKE ${`timeline:${id}:%`})`;
      return row;
    });

    if (!deleted) return { error: "That task no longer exists." };

    await recordAudit({
      user,
      action: "DELETE",
      entity: "staff_task",
      entityId: id,
      details: deleted.title,
    });
    revalidatePath("/timelines");
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    return { error: safeTaskError(error, "Could not delete that task.") };
  }
}

/** Quick status change straight from the table, without opening the editor. */
export async function setTaskStatusAction(fd: FormData): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.manage");
    const id = parsePositiveInt(fd.get("id"));
    const status = String(fd.get("status") ?? "").toUpperCase();
    if (!id || !isTaskStatus(status)) return { error: "Invalid task status." };

    const [updated] = await sql<{ id: number }[]>`
      UPDATE staff_tasks
      SET status = ${status},
          progress = CASE
            WHEN ${status} = 'COMPLETE' THEN 100
            WHEN ${status} = 'NOT_STARTED' THEN CASE WHEN progress IS NOT NULL THEN 0 ELSE NULL END
            ELSE progress
          END,
          progress_updated_at = CASE
            WHEN ${status} = 'COMPLETE' THEN now()
            WHEN ${status} = 'NOT_STARTED' AND progress IS NOT NULL THEN now()
            ELSE progress_updated_at
          END,
          progress_updated_by = CASE
            WHEN ${status} = 'COMPLETE' THEN ${user.userId}
            WHEN ${status} = 'NOT_STARTED' AND progress IS NOT NULL THEN ${user.userId}
            ELSE progress_updated_by
          END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id`;
    if (!updated) return { error: "That task no longer exists." };

    await recordAudit({
      user,
      action: "UPDATE",
      entity: "staff_task",
      entityId: id,
      details: `Status: ${status}`,
    });
    revalidatePath("/timelines");
    return { ok: true };
  } catch (error) {
    return { error: safeTaskError(error, "Could not update task status.") };
  }
}

/**
 * Progress is the one thing a person may change on their own task without
 * being given rights over everybody else's. Ownership is checked against the
 * row itself rather than trusted from the form, so a posted id cannot be used
 * to edit somebody else's timeline.
 */
export async function updateProgressAction(_prev: TaskState, fd: FormData): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.view");
    const id = parsePositiveInt(fd.get("id"));
    if (!id) return { error: "No task given." };

    const [task] = await sql<{ owner_id: number | null; title: string }[]>`
      SELECT owner_id, title FROM staff_tasks WHERE id = ${id}`;
    if (!task) return { error: "That task no longer exists." };

    const owns = task.owner_id === user.userId;
    const manages = await can(user.role, "timelines.manage");
    if (!owns && !manages) {
      return { error: "You can only update progress on tasks assigned to you." };
    }

    const rawProgress = progressOrNull(fd);
    if (rawProgress === null) return { error: "Give a progress figure between 0 and 100." };
    const note = text(fd, "progress_note") || null;
    const statusRaw = text(fd, "status").toUpperCase();
    const chosenStatus: TaskStatus = isTaskStatus(statusRaw)
      ? statusRaw
      : rawProgress >= 100
        ? "COMPLETE"
        : rawProgress > 0
          ? "ONGOING"
          : "NOT_STARTED";
    const synced = syncStatusAndProgress(chosenStatus, rawProgress);
    const finalProgress = synced.progress ?? rawProgress;

    const [updated] = await sql<{ id: number }[]>`
      UPDATE staff_tasks
         SET progress = ${finalProgress},
             progress_note = ${note},
             status = ${synced.status},
             progress_updated_at = now(),
             progress_updated_by = ${user.userId},
             updated_at = now()
       WHERE id = ${id}
       RETURNING id`;
    if (!updated) return { error: "That task no longer exists." };

    await recordAudit({
      user,
      action: "UPDATE",
      entity: "staff_task",
      entityId: id,
      details: `Progress ${finalProgress}% (${synced.status}) on ${task.title}${note ? ` - ${note}` : ""}`,
    });

    revalidatePath("/timelines");
    return { ok: true };
  } catch (error) {
    return { error: safeTaskError(error, "Could not save that update.") };
  }
}

export async function importTimelinesAction(_prev: TaskState, fd: FormData): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.manage");
    const file = fd.get("timeline_file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a workbook to import." };
    if (file.size > MAX_TIMELINE_UPLOAD_BYTES) {
      return { error: "Workbook exceeds the 10 MB upload limit." };
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return { error: "Only .xlsx workbooks are supported." };
    }

    const rawYear = text(fd, "year");
    let year = new Date().getFullYear();
    if (rawYear) {
      const parsedYear = Number(rawYear);
      if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
        return { error: "Enter a reporting year between 2000 and 2100." };
      }
      year = parsedYear;
    }

    const { tasks, sheets } = await parseTimelineWorkbook(await file.arrayBuffer(), year);
    if (!tasks.length) return { error: "No task rows found in that workbook." };

    const { added, existing } = await sql.begin(async (tx) => {
      const existingRows = await tx<{ area: string; title: string }[]>`
        SELECT lower(area) AS area, lower(title) AS title FROM staff_tasks`;
      const seen = new Set(existingRows.map((r) => `${r.area}\0${r.title}`));

      let addedCount = 0;
      let existingCount = 0;
      const toInsert: {
        area: string;
        position: number | null;
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
      }[] = [];

      for (const task of tasks) {
        const key = `${task.area.toLowerCase()}\0${task.title.toLowerCase()}`;
        if (seen.has(key)) {
          existingCount++;
          continue;
        }
        seen.add(key);
        toInsert.push({
          area: task.area,
          position: task.position,
          title: task.title,
          lead: task.lead,
          origin: task.origin,
          priority: task.priority,
          status: task.status,
          progress: task.progress,
          starts_on: task.startsOn,
          ends_on: task.endsOn,
          schedule_note: task.scheduleNote,
          comments: task.comments,
        });
        addedCount++;
      }

      if (toInsert.length > 0) {
        await tx`INSERT INTO staff_tasks ${tx(toInsert)}`;
      }
      return { added: addedCount, existing: existingCount };
    });

    await recordAudit({
      user,
      action: "IMPORT",
      entity: "staff_task",
      details: `${file.name}: ${added} added, ${existing} already tracked`,
    });

    const breakdown = sheets.map((s) => `${s.name} (${s.shape}, ${s.rows})`).join(", ");
    revalidatePath("/timelines");
    return {
      ok: true,
      message:
        `Imported ${added} task${added === 1 ? "" : "s"}` +
        (existing ? `, ${existing} already tracked` : "") +
        `. Sheets read: ${breakdown}.`,
    };
  } catch (error) {
    return { error: safeTaskError(error, "Could not read that workbook.") };
  }
}
