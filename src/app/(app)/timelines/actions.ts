"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { notify } from "@/lib/notifications";
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

const RECURRENCES = ["WEEKLY", "MONTHLY", "QUARTERLY"] as const;
type Recurrence = (typeof RECURRENCES)[number];
const isRecurrence = (v: string): v is Recurrence => (RECURRENCES as readonly string[]).includes(v);

/**
 * When a repeating task is completed, create its next occurrence with the
 * dates moved on by one interval. recurrence_next_id is claimed in the same
 * statement, so saving "complete" twice never creates two copies.
 */
async function spawnNextOccurrence(id: number, userId: number): Promise<void> {
  const rows = await sql<{ id: number; title: string }[]>`
    WITH src AS (
      SELECT * FROM staff_tasks
       WHERE id = ${id} AND status = 'COMPLETE' AND recurrence IS NOT NULL AND recurrence_next_id IS NULL
       FOR UPDATE
    ), step AS (
      SELECT CASE recurrence WHEN 'WEEKLY' THEN interval '7 days'
                             WHEN 'QUARTERLY' THEN interval '3 months'
                             ELSE interval '1 month' END AS gap
        FROM src
    ), ins AS (
      INSERT INTO staff_tasks (area, title, lead, origin, priority, status, progress, starts_on, ends_on,
                               schedule_note, comments, owner_id, recurrence)
      SELECT src.area, src.title, src.lead, src.origin, src.priority, 'NOT_STARTED',
             CASE WHEN src.progress IS NULL THEN NULL ELSE 0 END,
             (src.starts_on + step.gap)::date,
             (COALESCE(src.ends_on, src.starts_on, (now() AT TIME ZONE 'America/Port_of_Spain')::date) + step.gap)::date,
             src.schedule_note, src.comments, src.owner_id, src.recurrence
        FROM src, step
      RETURNING id, title
    )
    UPDATE staff_tasks SET recurrence_next_id = (SELECT id FROM ins)
     WHERE id = ${id} AND EXISTS (SELECT 1 FROM ins)
    RETURNING (SELECT id FROM ins) AS id, (SELECT title FROM ins) AS title`;
  const next = rows[0];
  if (next) {
    await sql`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      SELECT id, name || ' (' || email || ')', 'CREATE', 'staff_task', ${String(next.id)},
             ${`Next occurrence of a repeating task · ${next.title}`}
        FROM users WHERE id = ${userId}`;
  }
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
      recurrence: isRecurrence(text(fd, "recurrence").toUpperCase()) ? text(fd, "recurrence").toUpperCase() : null,
    };

    if (id) {
      const [existing] = await sql<{ progress: number | null; owner_id: number | null }[]>`
        SELECT progress, owner_id FROM staff_tasks WHERE id = ${id}`;
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
          recurrence = ${values.recurrence},
          progress_updated_at = CASE WHEN ${progressChanged} THEN now() ELSE progress_updated_at END,
          progress_updated_by = CASE WHEN ${progressChanged} THEN ${user.userId} ELSE progress_updated_by END,
          updated_at = now()
        WHERE id = ${id}
        RETURNING id`;
      if (!updated) return { error: "That task no longer exists." };
      await recordAudit({ user, action: "UPDATE", entity: "staff_task", entityId: id, details: title });
      if (values.status === "COMPLETE") await spawnNextOccurrence(id, user.userId);
      if (values.owner_id && values.owner_id !== existing.owner_id) {
        await notify({
          userId: values.owner_id,
          actorId: user.userId,
          kind: "task_assigned",
          title: `You're now accountable for "${title}"`,
          body: values.ends_on ? `Due ${values.ends_on}.` : null,
          href: `/timelines?mine=1&q=${encodeURIComponent(title.slice(0, 60))}`,
        });
      }
    } else {
      const hasProgress = values.progress !== null;
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO staff_tasks (area, title, lead, origin, priority, status, progress,
                                 starts_on, ends_on, schedule_note, comments, owner_id,
                                 progress_updated_at, progress_updated_by, recurrence)
        VALUES (${values.area}, ${values.title}, ${values.lead}, ${values.origin},
                ${values.priority}, ${values.status}, ${values.progress}, ${values.starts_on},
                ${values.ends_on}, ${values.schedule_note}, ${values.comments}, ${values.owner_id},
                ${hasProgress ? sql`now()` : null}, ${hasProgress ? user.userId : null}, ${values.recurrence})
        RETURNING id`;
      await recordAudit({ user, action: "CREATE", entity: "staff_task", entityId: row.id, details: title });
      await notify({
        userId: values.owner_id,
        actorId: user.userId,
        kind: "task_assigned",
        title: `You're now accountable for "${title}"`,
        body: values.ends_on ? `Due ${values.ends_on}.` : null,
        href: `/timelines?mine=1&q=${encodeURIComponent(title.slice(0, 60))}`,
      });
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
    if (status === "COMPLETE") await spawnNextOccurrence(id, user.userId);
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
    if (synced.status === "COMPLETE") await spawnNextOccurrence(id, user.userId);

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

export type BulkTaskOp =
  | { kind: "status"; status: string }
  | { kind: "owner"; ownerId: number | null }
  | { kind: "shift"; days: number }
  | { kind: "delete" };

/** Applies one change to many tasks in a single transaction. Managers only. */
export async function bulkUpdateTasksAction(rawIds: number[], op: BulkTaskOp): Promise<TaskState> {
  try {
    const user = await assertPermission("timelines.manage");
    const ids = [...new Set(rawIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 500);
    if (!ids.length) return { error: "Select at least one task." };

    let summary = "";
    let completed: number[] = [];
    await sql.begin(async (tx) => {
      if (op.kind === "status") {
        const status = String(op.status).toUpperCase();
        if (!isTaskStatus(status)) throw new Error("bad-status");
        await tx`
          UPDATE staff_tasks
             SET status = ${status},
                 progress = CASE WHEN ${status} = 'COMPLETE' THEN 100
                                 WHEN ${status} = 'NOT_STARTED' AND progress IS NOT NULL THEN 0
                                 ELSE progress END,
                 updated_at = now()
           WHERE id = ANY(${ids})`;
        summary = `Status set to ${status}`;
        if (status === "COMPLETE") completed = ids;
      } else if (op.kind === "owner") {
        if (op.ownerId !== null) {
          const [owner] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${op.ownerId}`;
          if (!owner || owner.status !== "ACTIVE") throw new Error("bad-owner");
        }
        const changed = await tx<{ id: number; title: string }[]>`
          UPDATE staff_tasks SET owner_id = ${op.ownerId}, updated_at = now()
           WHERE id = ANY(${ids}) AND owner_id IS DISTINCT FROM ${op.ownerId}
          RETURNING id, title`;
        summary = op.ownerId ? "Accountable person changed" : "Accountable person cleared";
        if (op.ownerId && changed.length) {
          await notify(
            {
              userId: op.ownerId,
              actorId: user.userId,
              kind: "task_assigned",
              title:
                changed.length === 1
                  ? `You're now accountable for "${changed[0].title}"`
                  : `You're now accountable for ${changed.length} tasks`,
              href: "/timelines?mine=1",
            },
            tx,
          );
        }
      } else if (op.kind === "shift") {
        const days = Math.trunc(Number(op.days));
        if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366) throw new Error("bad-shift");
        await tx`
          UPDATE staff_tasks
             SET starts_on = starts_on + ${days}::int, ends_on = ends_on + ${days}::int, updated_at = now()
           WHERE id = ANY(${ids})`;
        summary = `Dates moved ${days > 0 ? "forward" : "back"} ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
      } else {
        await tx`DELETE FROM staff_tasks WHERE id = ANY(${ids})`;
        summary = "Deleted";
      }
      await recordAudit({
        user,
        action: op.kind === "delete" ? "DELETE" : "UPDATE",
        entity: "staff_task",
        details: `${summary} on ${ids.length} task${ids.length === 1 ? "" : "s"}`,
        tx,
      });
    });

    for (const id of completed) await spawnNextOccurrence(id, user.userId);
    revalidatePath("/timelines");
    revalidatePath("/calendar");
    return { ok: true, message: `${summary} on ${ids.length} task${ids.length === 1 ? "" : "s"}.` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "bad-status") return { error: "Choose a valid status." };
    if (msg === "bad-owner") return { error: "That person can't be assigned." };
    if (msg === "bad-shift") return { error: "Choose how many days to move the dates." };
    return { error: safeTaskError(error, "Those tasks couldn't be updated.") };
  }
}
