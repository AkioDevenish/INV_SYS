"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  assertPermission,
  assertSignedIn,
  recordAudit,
  type CurrentUser,
  type SqlExecutor,
} from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isAssignedToProject } from "@/lib/projects";
import { ensureSchema } from "@/lib/setup";
import {
  REFERENCE_KINDS,
  astTodayKey,
  isActionState,
  isApprovalState,
  isIsoDate,
  isReferenceKind,
  type ReferenceKind,
} from "@/lib/project-meta";

export type ProjectState = { error?: string; ok?: boolean; id?: number };

const AUTH_ERROR_MESSAGES = new Set([
  "You are not signed in.",
  "You must choose a new password before continuing.",
  "Your role does not allow this action.",
]);

const STAFF_LOCK_NS = 7101;
const REF_LOCK_NS = 7102;

/* ---------- small parsing helpers ---------- */

class InputError extends Error {}

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function optText(fd: FormData, key: string, max = 4000): string | null {
  const v = text(fd, key);
  return v ? v.slice(0, max) : null;
}

function positiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= 2_147_483_647 ? raw : null;
  }
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2_147_483_647 ? n : null;
}

function optId(fd: FormData, key: string, label: string): number | null {
  const raw = text(fd, key);
  if (!raw) return null;
  const n = positiveInt(raw);
  if (!n) throw new InputError(`${label} isn't valid.`);
  return n;
}

function optDate(fd: FormData, key: string, label: string): string | null {
  const v = text(fd, key);
  if (!v) return null;
  if (!isIsoDate(v)) throw new InputError(`${label} isn't a valid date.`);
  return v;
}

function optAmount(fd: FormData, key: string, label: string): number | null {
  const raw = text(fd, key).replace(/,/g, "");
  if (!raw) return null;
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new InputError(`${label} must be zero or more.`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new InputError(`${label} must be zero or more.`);
  if (n > 999_999_999_999.99) throw new InputError(`${label} is too large.`);
  return Math.round(n * 100) / 100;
}

function idList(fd: FormData, key: string, label: string): number[] {
  const out = new Set<number>();
  for (const raw of fd.getAll(key)) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const n = positiveInt(s);
    if (!n) throw new InputError(`${label} isn't valid.`);
    out.add(n);
  }
  return [...out];
}

function requireOrder(start: string | null, end: string | null, message: string) {
  if (start && end && end < start) throw new InputError(message);
}

function failure(error: unknown, fallback: string): ProjectState {
  if (error instanceof InputError) return { error: error.message };
  if (error instanceof Error && AUTH_ERROR_MESSAGES.has(error.message)) {
    return { error: error.message };
  }
  const code = (error as { code?: string })?.code;
  if (code === "23505") return { error: "That would create a duplicate. Check the code or name." };
  if (code === "23503") return { error: "Something this record points to no longer exists, or it is still in use." };
  if (code === "23514") return { error: "Some values don't fit the rules for this record. Check dates and amounts." };
  if (code === "22007" || code === "22008") return { error: "One of the dates isn't valid." };
  if (code === "22P02" || code === "22003") return { error: "One of the values isn't valid." };
  console.error("Projects action error:", error);
  return { error: fallback };
}

function refresh(projectId?: number | null) {
  revalidatePath("/projects");
  revalidatePath("/projects/lists");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

async function projectExists(id: number, db: SqlExecutor = sql): Promise<boolean> {
  const [row] = await db<{ id: number }[]>`SELECT id FROM projects WHERE id = ${id}`;
  return Boolean(row);
}

/**
 * Managers can change anything. People currently assigned to the project may
 * also add updates and lessons and move their own actions along.
 */
async function assertProjectContributor(projectId: number): Promise<{ user: CurrentUser; manager: boolean }> {
  const user = await assertSignedIn();
  if (await can(user.role, "projects.manage")) return { user, manager: true };
  if ((await can(user.role, "projects.view")) && (await isAssignedToProject(projectId, user.userId))) {
    return { user, manager: false };
  }
  throw new InputError("Only project managers or staff assigned to this project can do that.");
}

/* ---------- projects ---------- */

export async function saveProjectAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const id = optId(fd, "id", "Project");

    const title = text(fd, "title").slice(0, 300);
    if (!title) return { error: "Give the project a title." };
    const code = optText(fd, "code", 50);
    const statusId = positiveInt(fd.get("status_id"));
    if (!statusId) return { error: "Choose an operational status (BR-02)." };
    const phaseId = optId(fd, "model_phase_id", "IICA model phase");
    const fundingStatusId = optId(fd, "funding_status_id", "Overall funding status");
    const start = optDate(fd, "start_date", "Start date");
    const target = optDate(fd, "target_end_date", "Target end date");
    const actual = optDate(fd, "actual_end_date", "Actual end date");
    requireOrder(start, target, "The target end date can't be before the start date.");
    requireOrder(start, actual, "The actual end date can't be before the start date.");
    const purpose = optText(fd, "purpose");
    const outcome = optText(fd, "outcome_summary");
    const areaIds = idList(fd, "area_ids", "Programme area");
    const tagIds = idList(fd, "tag_ids", "Tag");

    const savedId = await sql.begin(async (tx) => {
      let pid: number;
      if (id) {
        const [row] = await tx<{ id: number }[]>`
          UPDATE projects SET code = ${code}, title = ${title}, purpose = ${purpose},
                 status_id = ${statusId}, model_phase_id = ${phaseId}, funding_status_id = ${fundingStatusId},
                 start_date = ${start}, target_end_date = ${target}, actual_end_date = ${actual},
                 outcome_summary = ${outcome}, updated_at = now()
           WHERE id = ${id} RETURNING id`;
        if (!row) throw new InputError("That project no longer exists.");
        pid = row.id;
        await tx`DELETE FROM project_programme_areas WHERE project_id = ${pid}`;
        await tx`DELETE FROM project_tags WHERE project_id = ${pid}`;
      } else {
        const [row] = await tx<{ id: number }[]>`
          INSERT INTO projects (code, title, purpose, status_id, model_phase_id, funding_status_id,
                                start_date, target_end_date, actual_end_date, outcome_summary, created_by)
          VALUES (${code}, ${title}, ${purpose}, ${statusId}, ${phaseId}, ${fundingStatusId},
                  ${start}, ${target}, ${actual}, ${outcome}, ${user.userId})
          RETURNING id`;
        pid = row.id;
      }
      if (areaIds.length) {
        await tx`INSERT INTO project_programme_areas ${tx(
          areaIds.map((a) => ({ project_id: pid, programme_area_id: a })),
        )}`;
      }
      if (tagIds.length) {
        await tx`INSERT INTO project_tags ${tx(tagIds.map((t) => ({ project_id: pid, tag_id: t })))}`;
      }
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project",
        entityId: pid,
        details: code ? `${code} · ${title}` : title,
        tx,
      });
      return pid;
    });

    refresh(savedId);
    return { ok: true, id: savedId };
  } catch (error) {
    return failure(error, "The project couldn't be saved.");
  }
}

/** Quick phase change from the model stepper on the project page. */
export async function setProjectPhaseAction(projectId: number, phaseId: number | null): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const pid = positiveInt(projectId);
    if (!pid) return { error: "Invalid project." };
    let validPhaseId: number | null = null;
    if (phaseId !== null && phaseId !== undefined) {
      validPhaseId = positiveInt(phaseId);
      if (!validPhaseId) return { error: "Invalid model phase." };
    }

    await sql.begin(async (tx) => {
      const [row] = await tx<{ title: string }[]>`
        UPDATE projects SET model_phase_id = ${validPhaseId}, updated_at = now()
         WHERE id = ${pid} RETURNING title`;
      if (!row) throw new InputError("That project no longer exists.");
      await recordAudit({
        user,
        action: "UPDATE",
        entity: "project",
        entityId: pid,
        details: `Model phase changed · ${row.title}`,
        tx,
      });
    });

    refresh(pid);
    return { ok: true };
  } catch (error) {
    return failure(error, "The phase couldn't be changed.");
  }
}

/**
 * Deleting a project would erase its history, so the database refuses while
 * any updates, people, funding, actions or lessons point at it. Closing or
 * cancelling is the normal way to retire a project.
 */
export async function deleteProjectAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const id = positiveInt(fd.get("id"));
    if (!id) return { error: "Invalid project." };

    await sql.begin(async (tx) => {
      const [row] = await tx<{ title: string }[]>`DELETE FROM projects WHERE id = ${id} RETURNING title`;
      if (!row) throw new InputError("That project no longer exists.");
      await recordAudit({ user, action: "DELETE", entity: "project", entityId: id, details: row.title, tx });
    });

    refresh(id);
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string })?.code === "23503") {
      return {
        error:
          "This project has history (people, funding, updates, actions or lessons), so it can't be deleted. Set its status to Closed or Cancelled instead.",
      };
    }
    return failure(error, "The project couldn't be deleted.");
  }
}

/* ---------- staff assignments ---------- */

export async function saveStaffAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const projectId = positiveInt(fd.get("project_id"));
    const id = optId(fd, "id", "Assignment");
    const userId = positiveInt(fd.get("user_id"));
    const roleId = positiveInt(fd.get("role_id"));
    if (!projectId || !userId || !roleId) return { error: "Choose a person and a role." };
    const start = optDate(fd, "start_date", "Start date");
    const end = optDate(fd, "end_date", "End date");
    requireOrder(start, end, "The end date can't be before the start date.");

    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${STAFF_LOCK_NS}, ${projectId})`;
      if (!(await projectExists(projectId, tx))) throw new InputError("That project no longer exists.");

      if (id) {
        const [existing] = await tx<{ user_id: number }[]>`
          SELECT user_id FROM project_staff WHERE id = ${id} AND project_id = ${projectId}`;
        if (!existing) throw new InputError("That assignment no longer exists.");
        if (existing.user_id !== userId) {
          const [assignee] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}`;
          if (!assignee) throw new InputError("That person no longer exists.");
          if (assignee.status !== "ACTIVE") throw new InputError("Disabled accounts can't be assigned to a project.");
        }
      } else {
        const [assignee] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}`;
        if (!assignee) throw new InputError("That person no longer exists.");
        if (assignee.status !== "ACTIVE") throw new InputError("Disabled accounts can't be assigned to a project.");
      }

      const isCurrentAssignment = !end || end >= astTodayKey();
      if (isCurrentAssignment) {
        const [dupe] = await tx<{ id: number }[]>`
          SELECT id FROM project_staff
           WHERE project_id = ${projectId} AND user_id = ${userId} AND role_id = ${roleId}
             AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date)
             ${id ? tx`AND id <> ${id}` : tx``}
           LIMIT 1`;
        if (dupe) throw new InputError("That person already holds this role on the project.");
      }

      if (id) {
        const [updated] = await tx<{ id: number }[]>`
          UPDATE project_staff
             SET user_id = ${userId}, role_id = ${roleId}, start_date = ${start}, end_date = ${end}
           WHERE id = ${id} AND project_id = ${projectId}
           RETURNING id`;
        if (!updated) throw new InputError("That assignment no longer exists.");
      } else {
        await tx`
          INSERT INTO project_staff (project_id, user_id, role_id, start_date, end_date)
          VALUES (${projectId}, ${userId}, ${roleId}, ${start}, ${end})`;
      }

      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_staff",
        entityId: projectId,
        details: "Staff assignment",
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The assignment couldn't be saved.");
  }
}

/* ---------- stakeholder involvement ---------- */

export async function saveStakeholderLinkAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const id = optId(fd, "id", "Stakeholder record");
    const stakeholderId = optId(fd, "stakeholder_id", "Stakeholder");
    const typedName = optText(fd, "stakeholder_name", 200);
    if (!stakeholderId && !typedName) return { error: "Choose a stakeholder from the directory or type a name." };
    const role = optText(fd, "involvement_role", 100);
    const start = optDate(fd, "start_date", "Start date");
    const end = optDate(fd, "end_date", "End date");
    requireOrder(start, end, "The end date can't be before the start date.");
    const notes = optText(fd, "notes");
    const name = stakeholderId ? null : typedName;

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("That project no longer exists.");
      if (id) {
        const [updated] = await tx<{ id: number }[]>`
          UPDATE project_stakeholders
             SET stakeholder_id = ${stakeholderId}, stakeholder_name = ${name}, involvement_role = ${role},
                 start_date = ${start}, end_date = ${end}, notes = ${notes}
           WHERE id = ${id} AND project_id = ${projectId}
           RETURNING id`;
        if (!updated) throw new InputError("That stakeholder record no longer exists.");
      } else {
        await tx`
          INSERT INTO project_stakeholders (project_id, stakeholder_id, stakeholder_name, involvement_role, start_date, end_date, notes)
          VALUES (${projectId}, ${stakeholderId}, ${name}, ${role}, ${start}, ${end}, ${notes})`;
      }
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_stakeholder",
        entityId: projectId,
        details: role ?? "Stakeholder involvement",
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The stakeholder couldn't be saved.");
  }
}

/* ---------- funding ---------- */

export async function saveFundingAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const id = optId(fd, "id", "Funding record");
    const funderId = optId(fd, "stakeholder_id", "Funder");
    const typedName = optText(fd, "stakeholder_name", 200);
    if (!funderId && !typedName) return { error: "Choose the funder from the directory or type its name." };
    const statusId = optId(fd, "funding_status_id", "Funding status");
    const statusDate = optDate(fd, "status_date", "Status date");
    const requested = optAmount(fd, "amount_requested", "Requested amount");
    const approved = optAmount(fd, "amount_approved", "Approved amount");
    const received = optAmount(fd, "amount_received", "Received amount");
    const currencyRaw = text(fd, "currency_code").toUpperCase();
    const currency = currencyRaw || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "Currency must be a three-letter code such as TTD or USD." };
    if (!currency && (requested !== null || approved !== null || received !== null)) {
      return { error: "Choose the currency for these amounts (BR-12 keeps currencies apart)." };
    }
    const notes = optText(fd, "notes");
    const name = funderId ? null : typedName;

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("That project no longer exists.");
      if (id) {
        const [updated] = await tx<{ id: number }[]>`
          UPDATE project_funding
             SET funder_id = ${funderId}, funder_name = ${name}, funding_status_id = ${statusId}, status_date = ${statusDate},
                 amount_requested = ${requested}, amount_approved = ${approved}, amount_received = ${received},
                 currency_code = ${currency}, notes = ${notes}, updated_at = now()
           WHERE id = ${id} AND project_id = ${projectId}
           RETURNING id`;
        if (!updated) throw new InputError("That funding record no longer exists.");
      } else {
        await tx`
          INSERT INTO project_funding (project_id, funder_id, funder_name, funding_status_id, status_date,
                                       amount_requested, amount_approved, amount_received, currency_code, notes)
          VALUES (${projectId}, ${funderId}, ${name}, ${statusId}, ${statusDate},
                  ${requested}, ${approved}, ${received}, ${currency}, ${notes})`;
      }
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_funding",
        entityId: projectId,
        details: currency ? `Funding in ${currency}` : "Funding record",
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The funding record couldn't be saved.");
  }
}

/* ---------- updates ---------- */

export async function saveUpdateAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const { user, manager } = await assertProjectContributor(projectId);
    const id = optId(fd, "id", "Update");
    const body = optText(fd, "body", 8000);
    if (!body) return { error: "Describe what happened, changed or was decided." };
    const date = optDate(fd, "update_date", "Date") ?? astTodayKey();

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("Invalid project.");
      if (id) {
        const [row] = await tx<{ id: number }[]>`
          UPDATE project_updates SET body = ${body}, update_date = ${date}
           WHERE id = ${id} AND project_id = ${projectId} AND (${manager} OR recorded_by = ${user.userId})
           RETURNING id`;
        if (!row) throw new InputError("You can only edit updates you recorded.");
      } else {
        await tx`
          INSERT INTO project_updates (project_id, update_date, body, recorded_by)
          VALUES (${projectId}, ${date}, ${body}, ${user.userId})`;
      }
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_update",
        entityId: projectId,
        details: body.slice(0, 120),
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The update couldn't be saved.");
  }
}

/* ---------- follow-up actions ---------- */

export async function saveActionItemAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const id = optId(fd, "id", "Action");
    const description = optText(fd, "description", 2000);
    if (!description) return { error: "Describe the action to be taken." };
    const assignee = optId(fd, "assigned_user_id", "Assignee");
    const due = optDate(fd, "due_date", "Due date");
    const rawState = text(fd, "state") || "OPEN";
    if (!isActionState(rawState)) return { error: "Choose a valid state." };
    const providedCompleted = optDate(fd, "completed_on", "Completed date");

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("That project no longer exists.");
      let completed: string | null = providedCompleted;
      if (rawState !== "DONE") {
        completed = null;
      } else if (!completed) {
        if (id) {
          const [existing] = await tx<{ completed_on: string | null }[]>`
            SELECT to_char(completed_on, 'YYYY-MM-DD') AS completed_on
              FROM project_actions
             WHERE id = ${id} AND project_id = ${projectId}`;
          completed = existing?.completed_on ?? astTodayKey();
        } else {
          completed = astTodayKey();
        }
      }
      if (id) {
        const [updated] = await tx<{ id: number }[]>`
          UPDATE project_actions SET description = ${description}, assigned_user_id = ${assignee}, due_date = ${due},
                 state = ${rawState}, completed_on = ${completed}, updated_at = now()
           WHERE id = ${id} AND project_id = ${projectId}
           RETURNING id`;
        if (!updated) throw new InputError("That action no longer exists.");
      } else {
        await tx`
          INSERT INTO project_actions (project_id, description, assigned_user_id, due_date, state, completed_on, created_by)
          VALUES (${projectId}, ${description}, ${assignee}, ${due}, ${rawState}, ${completed}, ${user.userId})`;
      }
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_action",
        entityId: projectId,
        details: description.slice(0, 120),
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The action couldn't be saved.");
  }
}

/** One-click state change; the assignee may do this as well as a manager. */
export async function setActionStateAction(actionId: number, state: string): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertSignedIn();
    const id = positiveInt(actionId);
    if (!id) return { error: "Invalid action." };
    if (!isActionState(state)) return { error: "Choose a valid state." };

    const manager = await can(user.role, "projects.manage");
    const canView = manager || (await can(user.role, "projects.view"));
    if (!canView) return { error: "Your role does not allow this action." };

    const today = astTodayKey();
    const projectId = await sql.begin(async (tx) => {
      const [row] = await tx<{ project_id: number; assigned_user_id: number | null }[]>`
        SELECT project_id, assigned_user_id FROM project_actions WHERE id = ${id}`;
      if (!row) throw new InputError("That action no longer exists.");
      if (!manager && row.assigned_user_id !== user.userId) {
        throw new InputError("Only a project manager or the person assigned can change this action.");
      }
      const [updated] = await tx<{ project_id: number }[]>`
        UPDATE project_actions
           SET state = ${state},
               completed_on = CASE WHEN ${state} = 'DONE'
                                   THEN COALESCE(completed_on, ${today}::date)
                                   ELSE NULL END,
               updated_at = now()
         WHERE id = ${id} AND (${manager} OR assigned_user_id = ${user.userId})
         RETURNING project_id`;
      if (!updated) throw new InputError("That action no longer exists.");
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${updated.project_id}`;
      await recordAudit({
        user,
        action: "UPDATE",
        entity: "project_action",
        entityId: updated.project_id,
        details: `Action marked ${state}`,
        tx,
      });
      return updated.project_id;
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The action couldn't be updated.");
  }
}

/* ---------- documents ---------- */

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("//")) throw new InputError("Links must start with http or https.");
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new InputError("Links must start with http or https.");
    if (!u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost")) {
      throw new InputError("That link isn't a valid web address.");
    }
    return u.toString();
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError("That link isn't a valid web address.");
  }
}

export async function saveDocumentAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const purpose = optText(fd, "link_purpose", 100);
    const existingId = optId(fd, "existing_resource_id", "Existing document");
    const resourceId = optId(fd, "resource_id", "Document");

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("That project no longer exists.");

      if (existingId) {
        const [exists] = await tx<{ title: string }[]>`
          SELECT title FROM document_resources WHERE id = ${existingId}`;
        if (!exists) throw new InputError("That document no longer exists.");
        await tx`
          INSERT INTO project_documents (project_id, resource_id, link_purpose)
          VALUES (${projectId}, ${existingId}, ${purpose})
          ON CONFLICT (project_id, resource_id) DO UPDATE SET link_purpose = EXCLUDED.link_purpose`;
        await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
        await recordAudit({
          user,
          action: "CREATE",
          entity: "project_document",
          entityId: projectId,
          details: `Linked existing document · ${exists.title}`.slice(0, 120),
          tx,
        });
        return;
      }

      const title = optText(fd, "title", 300);
      if (!title) throw new InputError("Give the document a title.");
      const type = optText(fd, "resource_type", 50);
      const url = safeUrl(optText(fd, "url", 2000));
      const version = optText(fd, "version_label", 30);
      const approval = text(fd, "approval_state") || "DRAFT";
      if (!isApprovalState(approval)) throw new InputError("Choose draft or approved final.");

      if (resourceId) {
        const [linked] = await tx<{ resource_id: number }[]>`
          UPDATE project_documents SET link_purpose = ${purpose}
           WHERE project_id = ${projectId} AND resource_id = ${resourceId}
           RETURNING resource_id`;
        if (!linked) throw new InputError("That document is not linked to this project.");
        const [updated] = await tx<{ id: number }[]>`
          UPDATE document_resources
             SET title = ${title}, resource_type = ${type}, url = ${url},
                 version_label = ${version}, approval_state = ${approval}
           WHERE id = ${resourceId}
           RETURNING id`;
        if (!updated) throw new InputError("That document no longer exists.");
      } else {
        const [row] = await tx<{ id: number }[]>`
          INSERT INTO document_resources (title, resource_type, url, version_label, approval_state, registered_on, created_by)
          VALUES (${title}, ${type}, ${url}, ${version}, ${approval}, ${astTodayKey()}::date, ${user.userId})
          RETURNING id`;
        await tx`INSERT INTO project_documents (project_id, resource_id, link_purpose) VALUES (${projectId}, ${row.id}, ${purpose})`;
      }

      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: resourceId ? "UPDATE" : "CREATE",
        entity: "project_document",
        entityId: projectId,
        details: title.slice(0, 120),
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The document couldn't be saved.");
  }
}

/* ---------- lessons ---------- */

export async function saveLessonAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const projectId = positiveInt(fd.get("project_id"));
    if (!projectId) return { error: "Invalid project." };
    const { user, manager } = await assertProjectContributor(projectId);
    const id = optId(fd, "id", "Lesson");
    const body = optText(fd, "body", 8000);
    if (!body) return { error: "Write down what was learned and what it means for future work." };
    const date = optDate(fd, "recorded_on", "Date") ?? astTodayKey();

    await sql.begin(async (tx) => {
      if (!(await projectExists(projectId, tx))) throw new InputError("Invalid project.");
      if (id) {
        const [row] = await tx<{ id: number }[]>`
          UPDATE project_lessons SET body = ${body}, recorded_on = ${date}
           WHERE id = ${id} AND project_id = ${projectId} AND (${manager} OR recorded_by = ${user.userId})
           RETURNING id`;
        if (!row) throw new InputError("You can only edit lessons you recorded.");
      } else {
        await tx`
          INSERT INTO project_lessons (project_id, body, recorded_on, recorded_by)
          VALUES (${projectId}, ${body}, ${date}, ${user.userId})`;
      }
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_lesson",
        entityId: projectId,
        details: body.slice(0, 120),
        tx,
      });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "The lesson couldn't be saved.");
  }
}

/* ---------- removing child records ---------- */

const CHILD_KINDS = ["staff", "stakeholder", "funding", "update", "action", "document", "lesson"] as const;
type ChildKind = (typeof CHILD_KINDS)[number];

export async function removeProjectRecordAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const kind = text(fd, "kind") as ChildKind;
    if (!(CHILD_KINDS as readonly string[]).includes(kind)) return { error: "Unknown record." };
    const projectId = positiveInt(fd.get("project_id"));
    const id = positiveInt(fd.get("id"));
    if (!projectId || !id) return { error: "Invalid record." };

    // Authors may remove their own updates and lessons; everything else needs a manager.
    let user: CurrentUser;
    let manager = false;
    if (kind === "update" || kind === "lesson") {
      const who = await assertProjectContributor(projectId);
      user = who.user;
      manager = who.manager;
    } else {
      user = await assertPermission("projects.manage");
      manager = true;
    }

    await sql.begin(async (tx) => {
      let removed = 0;
      switch (kind) {
        case "staff":
          removed = (await tx`DELETE FROM project_staff WHERE id = ${id} AND project_id = ${projectId}`).count;
          break;
        case "stakeholder":
          removed = (await tx`DELETE FROM project_stakeholders WHERE id = ${id} AND project_id = ${projectId}`).count;
          break;
        case "funding":
          removed = (await tx`DELETE FROM project_funding WHERE id = ${id} AND project_id = ${projectId}`).count;
          break;
        case "update":
          removed = (await tx`
            DELETE FROM project_updates
             WHERE id = ${id} AND project_id = ${projectId} AND (${manager} OR recorded_by = ${user.userId})`).count;
          break;
        case "action":
          removed = (await tx`DELETE FROM project_actions WHERE id = ${id} AND project_id = ${projectId}`).count;
          break;
        case "lesson":
          removed = (await tx`
            DELETE FROM project_lessons
             WHERE id = ${id} AND project_id = ${projectId} AND (${manager} OR recorded_by = ${user.userId})`).count;
          break;
        case "document":
          // Unlink, and drop the resource itself only once no project uses it.
          removed = (await tx`DELETE FROM project_documents WHERE project_id = ${projectId} AND resource_id = ${id}`).count;
          if (removed) {
            await tx`
              DELETE FROM document_resources r
               WHERE r.id = ${id} AND NOT EXISTS (SELECT 1 FROM project_documents d WHERE d.resource_id = r.id)`;
          }
          break;
      }
      if (!removed) throw new InputError("Nothing was removed. It may already be gone, or it isn't yours to remove.");
      await tx`UPDATE projects SET updated_at = now() WHERE id = ${projectId}`;
      await recordAudit({ user, action: "DELETE", entity: `project_${kind}`, entityId: projectId, details: `Removed ${kind}`, tx });
    });

    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error, "That couldn't be removed.");
  }
}

/* ---------- reference lists ---------- */

const REF_TABLE: Record<ReferenceKind, string> = {
  status: "project_statuses",
  phase: "project_model_phases",
  fundingStatus: "project_funding_statuses",
  role: "project_roles",
  programmeArea: "programme_areas",
  tag: "project_tag_list",
};

export async function saveReferenceAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const kindRaw = text(fd, "kind");
    if (!isReferenceKind(kindRaw)) return { error: "Unknown list." };
    const kind = kindRaw;
    const id = optId(fd, "id", "Entry");
    const name = text(fd, "name").slice(0, 200);
    if (!name) return { error: "Enter a name." };
    const definition = optText(fd, "definition", 2000);

    const rawPos = text(fd, "position");
    let position = 0;
    if (rawPos) {
      if (!/^-?\d+$/.test(rawPos)) return { error: "Order must be a whole number." };
      position = Math.max(0, Math.min(999, Number(rawPos)));
    }
    const table = REF_TABLE[kind];
    const closed = fd.get("is_closed") === "on";
    const category = optText(fd, "category", 50);

    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${REF_LOCK_NS}, ${REFERENCE_KINDS.indexOf(kind) + 1})`;
      const clash = await tx.unsafe<{ id: number }[]>(
        `SELECT id FROM ${table} WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1`,
        [name, id ?? 0],
      );
      if (clash.length) throw new InputError(`There is already an entry called “${name}”.`);

      if (kind === "phase") {
        if (!id) throw new InputError("The model has eight fixed phases; rename one instead.");
        const [updated] = await tx<{ id: number }[]>`
          UPDATE project_model_phases SET name = ${name}, definition = ${definition}
           WHERE id = ${id} RETURNING id`;
        if (!updated) throw new InputError("That entry no longer exists.");
      } else if (kind === "status") {
        if (id) {
          const [updated] = await tx<{ id: number }[]>`
            UPDATE project_statuses SET name = ${name}, definition = ${definition}, position = ${position}, is_closed = ${closed}
             WHERE id = ${id} RETURNING id`;
          if (!updated) throw new InputError("That entry no longer exists.");
        } else {
          await tx`
            INSERT INTO project_statuses (name, definition, position, is_closed)
            VALUES (${name}, ${definition}, ${position}, ${closed})`;
        }
      } else if (kind === "tag") {
        if (id) {
          const [updated] = await tx<{ id: number }[]>`
            UPDATE project_tag_list SET name = ${name}, definition = ${definition}, category = ${category}, position = ${position}
             WHERE id = ${id} RETURNING id`;
          if (!updated) throw new InputError("That entry no longer exists.");
        } else {
          await tx`
            INSERT INTO project_tag_list (name, definition, category, position)
            VALUES (${name}, ${definition}, ${category}, ${position})`;
        }
      } else if (id) {
        const updated = await tx.unsafe<{ id: number }[]>(
          `UPDATE ${table} SET name = $1, definition = $2, position = $3 WHERE id = $4 RETURNING id`,
          [name, definition, position, id],
        );
        if (!updated.length) throw new InputError("That entry no longer exists.");
      } else {
        await tx.unsafe(
          `INSERT INTO ${table} (name, definition, position) VALUES ($1, $2, $3)`,
          [name, definition, position],
        );
      }

      await recordAudit({
        user,
        action: id ? "UPDATE" : "CREATE",
        entity: "project_reference",
        entityId: kind,
        details: name,
        tx,
      });
    });

    revalidatePath("/projects", "layout");
    return { ok: true };
  } catch (error) {
    return failure(error, "The entry couldn't be saved.");
  }
}

export async function deleteReferenceAction(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  try {
    await ensureSchema();
    const user = await assertPermission("projects.manage");
    const kindRaw = text(fd, "kind");
    if (!isReferenceKind(kindRaw)) return { error: "Unknown list." };
    if (kindRaw === "phase") return { error: "Model phases can be renamed but not removed." };
    const id = positiveInt(fd.get("id"));
    if (!id) return { error: "Invalid entry." };

    await sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ name: string }[]>(
        `DELETE FROM ${REF_TABLE[kindRaw]} WHERE id = $1 RETURNING name`,
        [id],
      );
      if (!rows.length) throw new InputError("That entry no longer exists.");
      await recordAudit({
        user,
        action: "DELETE",
        entity: "project_reference",
        entityId: kindRaw,
        details: rows[0].name,
        tx,
      });
    });

    revalidatePath("/projects", "layout");
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string })?.code === "23503") {
      return { error: "This entry is still used by projects, so it can't be removed. Rename it, or reassign those projects first." };
    }
    return failure(error, "The entry couldn't be removed.");
  }
}
