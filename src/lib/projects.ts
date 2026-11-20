import "server-only";
import { cache } from "react";
import { sql } from "./db";
import { ensureSchema } from "./setup";
import { astTodayKey, type ReferenceKind } from "./project-meta";

/**
 * Reads for the project life cycle system. Every exported function waits on
 * ensureSchema() first: the tables are new, and a signed-in person can reach
 * /projects without passing through the pages that normally bootstrap them.
 * The promise is cached per process, so after the first call this is free.
 */

const MAX_PG_INT = 2_147_483_647;

function isValidPgInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PG_INT;
}

export type RefOption = {
  id: number;
  name: string;
  definition: string | null;
  position: number;
  is_closed?: boolean;
  category?: string | null;
  usage: number;
};

export type ReferenceLists = Record<ReferenceKind, RefOption[]>;

export const getReferenceLists = cache(async (): Promise<ReferenceLists> => {
  await ensureSchema();
  const [status, phase, fundingStatus, role, programmeArea, tag] = await Promise.all([
    sql<RefOption[]>`
      SELECT s.id, s.name, s.definition, s.position, s.is_closed,
             COUNT(p.id)::int AS usage
        FROM project_statuses s
        LEFT JOIN projects p ON p.status_id = s.id
       GROUP BY s.id
       ORDER BY s.position, lower(s.name), s.id`,
    sql<RefOption[]>`
      SELECT m.id, m.name, m.definition, m.phase_order AS position,
             COUNT(p.id)::int AS usage
        FROM project_model_phases m
        LEFT JOIN projects p ON p.model_phase_id = m.id
       GROUP BY m.id
       ORDER BY m.phase_order, m.id`,
    sql<RefOption[]>`
      WITH p_counts AS (
        SELECT funding_status_id, COUNT(*)::int AS n
          FROM projects
         WHERE funding_status_id IS NOT NULL
         GROUP BY funding_status_id
      ),
      pf_counts AS (
        SELECT funding_status_id, COUNT(*)::int AS n
          FROM project_funding
         WHERE funding_status_id IS NOT NULL
         GROUP BY funding_status_id
      )
      SELECT f.id, f.name, f.definition, f.position,
             (COALESCE(pc.n, 0) + COALESCE(pfc.n, 0))::int AS usage
        FROM project_funding_statuses f
        LEFT JOIN p_counts pc ON pc.funding_status_id = f.id
        LEFT JOIN pf_counts pfc ON pfc.funding_status_id = f.id
       ORDER BY f.position, lower(f.name), f.id`,
    sql<RefOption[]>`
      SELECT r.id, r.name, r.definition, r.position,
             COUNT(ps.id)::int AS usage
        FROM project_roles r
        LEFT JOIN project_staff ps ON ps.role_id = r.id
       GROUP BY r.id
       ORDER BY r.position, lower(r.name), r.id`,
    sql<RefOption[]>`
      SELECT a.id, a.name, a.definition, a.position,
             COUNT(x.project_id)::int AS usage
        FROM programme_areas a
        LEFT JOIN project_programme_areas x ON x.programme_area_id = a.id
       GROUP BY a.id
       ORDER BY a.position, lower(a.name), a.id`,
    sql<RefOption[]>`
      SELECT t.id, t.name, t.definition, t.position, t.category,
             COUNT(x.project_id)::int AS usage
        FROM project_tag_list t
        LEFT JOIN project_tags x ON x.tag_id = t.id
       GROUP BY t.id
       ORDER BY lower(COALESCE(t.category, '')), t.position, lower(t.name), t.id`,
  ]);
  return { status, phase, fundingStatus, role, programmeArea, tag };
});

export type CurrencyTotal = {
  currency: string;
  requested: number;
  approved: number;
  received: number;
  has_approved: boolean;
};

export type NamedRef = { id: number; name: string };

export type ProjectSummary = {
  id: number;
  code: string | null;
  title: string;
  purpose: string | null;
  outcome_summary: string | null;
  status_id: number;
  status_name: string;
  status_position: number;
  is_closed: boolean;
  model_phase_id: number | null;
  phase_order: number | null;
  phase_name: string | null;
  funding_status_id: number | null;
  funding_status_name: string | null;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  updated_on: string;
  areas: NamedRef[];
  tags: NamedRef[];
  staff: { user_id: number; name: string; role: string }[];
  open_actions: number;
  overdue_actions: number;
  update_count: number;
  last_update_date: string | null;
  last_update_body: string | null;
  lesson_count: number;
  stakeholder_count: number;
  funding: CurrencyTotal[];
};

export const listProjects = cache(async (): Promise<ProjectSummary[]> => {
  await ensureSchema();
  return sql<ProjectSummary[]>`
    WITH
      area_agg AS (
        SELECT x.project_id,
               json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.position, lower(a.name), a.id) AS areas
          FROM project_programme_areas x
          JOIN programme_areas a ON a.id = x.programme_area_id
         GROUP BY x.project_id
      ),
      tag_agg AS (
        SELECT x.project_id,
               json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.position, lower(t.name), t.id) AS tags
          FROM project_tags x
          JOIN project_tag_list t ON t.id = x.tag_id
         GROUP BY x.project_id
      ),
      staff_agg AS (
        SELECT ps.project_id,
               json_agg(json_build_object('user_id', u.id, 'name', u.name, 'role', r.name)
                        ORDER BY r.position, lower(u.name), u.id, ps.id) AS staff
          FROM project_staff ps
          JOIN users u ON u.id = ps.user_id
          JOIN project_roles r ON r.id = ps.role_id
         WHERE ps.end_date IS NULL
            OR ps.end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date
         GROUP BY ps.project_id
      ),
      action_agg AS (
        SELECT a.project_id,
               COUNT(*) FILTER (WHERE a.state IN ('OPEN', 'IN_PROGRESS'))::int AS open_actions,
               COUNT(*) FILTER (
                 WHERE a.state IN ('OPEN', 'IN_PROGRESS')
                   AND a.due_date < (now() AT TIME ZONE 'America/Port_of_Spain')::date
               )::int AS overdue_actions
          FROM project_actions a
         GROUP BY a.project_id
      ),
      update_agg AS (
        SELECT u.project_id, COUNT(*)::int AS update_count
          FROM project_updates u
         GROUP BY u.project_id
      ),
      last_update AS (
        SELECT DISTINCT ON (u.project_id)
               u.project_id,
               to_char(u.update_date, 'YYYY-MM-DD') AS last_update_date,
               u.body AS last_update_body
          FROM project_updates u
         ORDER BY u.project_id, u.update_date DESC, u.id DESC
      ),
      lesson_agg AS (
        SELECT l.project_id, COUNT(*)::int AS lesson_count
          FROM project_lessons l
         GROUP BY l.project_id
      ),
      stakeholder_agg AS (
        SELECT x.project_id, COUNT(*)::int AS stakeholder_count
          FROM project_stakeholders x
         GROUP BY x.project_id
      ),
      funding_by_currency AS (
        SELECT pf.project_id,
               btrim(pf.currency_code) AS currency_code,
               COALESCE(SUM(pf.amount_requested), 0)::float8 AS requested,
               COALESCE(SUM(pf.amount_approved), 0)::float8 AS approved,
               COALESCE(SUM(pf.amount_received), 0)::float8 AS received,
               BOOL_OR(pf.amount_approved IS NOT NULL) AS has_approved
          FROM project_funding pf
         WHERE pf.currency_code IS NOT NULL
         GROUP BY pf.project_id, btrim(pf.currency_code)
      ),
      funding_agg AS (
        SELECT f.project_id,
               json_agg(
                 json_build_object(
                   'currency', f.currency_code,
                   'requested', f.requested,
                   'approved', f.approved,
                   'received', f.received,
                   'has_approved', f.has_approved
                 )
                 ORDER BY f.currency_code
               ) AS funding
          FROM funding_by_currency f
         GROUP BY f.project_id
      )
    SELECT p.id, p.code, p.title, p.purpose, p.outcome_summary,
           p.status_id, s.name AS status_name, s.position AS status_position, s.is_closed,
           p.model_phase_id, ph.phase_order, ph.name AS phase_name,
           p.funding_status_id, fs.name AS funding_status_name,
           to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(p.target_end_date, 'YYYY-MM-DD') AS target_end_date,
           to_char(p.actual_end_date, 'YYYY-MM-DD') AS actual_end_date,
           to_char(p.updated_at AT TIME ZONE 'America/Port_of_Spain', 'YYYY-MM-DD') AS updated_on,
           COALESCE(aa.areas, '[]'::json) AS areas,
           COALESCE(ta.tags, '[]'::json) AS tags,
           COALESCE(sa.staff, '[]'::json) AS staff,
           COALESCE(ac.open_actions, 0) AS open_actions,
           COALESCE(ac.overdue_actions, 0) AS overdue_actions,
           COALESCE(ua.update_count, 0) AS update_count,
           lu.last_update_date,
           lu.last_update_body,
           COALESCE(la.lesson_count, 0) AS lesson_count,
           COALESCE(xa.stakeholder_count, 0) AS stakeholder_count,
           COALESCE(fa.funding, '[]'::json) AS funding
      FROM projects p
      JOIN project_statuses s ON s.id = p.status_id
      LEFT JOIN project_model_phases ph ON ph.id = p.model_phase_id
      LEFT JOIN project_funding_statuses fs ON fs.id = p.funding_status_id
      LEFT JOIN area_agg aa ON aa.project_id = p.id
      LEFT JOIN tag_agg ta ON ta.project_id = p.id
      LEFT JOIN staff_agg sa ON sa.project_id = p.id
      LEFT JOIN action_agg ac ON ac.project_id = p.id
      LEFT JOIN update_agg ua ON ua.project_id = p.id
      LEFT JOIN last_update lu ON lu.project_id = p.id
      LEFT JOIN lesson_agg la ON la.project_id = p.id
      LEFT JOIN stakeholder_agg xa ON xa.project_id = p.id
      LEFT JOIN funding_agg fa ON fa.project_id = p.id
     ORDER BY s.is_closed, s.position, lower(p.title), p.id`;
});

export type LessonRow = {
  id: number;
  project_id: number;
  project_title: string;
  project_code: string | null;
  body: string;
  recorded_on: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  areas: NamedRef[];
};

export const listAllLessons = cache(async (): Promise<LessonRow[]> => {
  await ensureSchema();
  return sql<LessonRow[]>`
    WITH area_agg AS (
      SELECT x.project_id,
             json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.position, lower(a.name), a.id) AS areas
        FROM project_programme_areas x
        JOIN programme_areas a ON a.id = x.programme_area_id
       GROUP BY x.project_id
    )
    SELECT l.id, l.project_id, p.title AS project_title, p.code AS project_code, l.body,
           to_char(l.recorded_on, 'YYYY-MM-DD') AS recorded_on, l.recorded_by, u.name AS recorded_by_name,
           COALESCE(aa.areas, '[]'::json) AS areas
      FROM project_lessons l
      JOIN projects p ON p.id = l.project_id
      LEFT JOIN users u ON u.id = l.recorded_by
      LEFT JOIN area_agg aa ON aa.project_id = p.id
     ORDER BY l.recorded_on DESC, l.id DESC`;
});

export type StaffRow = {
  id: number;
  user_id: number;
  name: string;
  user_active: boolean;
  role_id: number;
  role_name: string;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
};

export type StakeholderLinkRow = {
  id: number;
  stakeholder_id: number | null;
  name: string;
  organisation: string | null;
  email: string | null;
  involvement_role: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
};

export type FundingRow = {
  id: number;
  funder_id: number | null;
  funder: string;
  funder_organisation: string | null;
  funding_status_id: number | null;
  funding_status_name: string | null;
  status_date: string | null;
  amount_requested: number | null;
  amount_approved: number | null;
  amount_received: number | null;
  currency_code: string | null;
  notes: string | null;
};

export type UpdateRow = {
  id: number;
  update_date: string;
  body: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  entered_at: string;
};

export type ActionRow = {
  id: number;
  description: string;
  assigned_user_id: number | null;
  assigned_name: string | null;
  due_date: string | null;
  state: string;
  completed_on: string | null;
};

export type DocumentRow = {
  resource_id: number;
  title: string;
  resource_type: string | null;
  url: string | null;
  version_label: string | null;
  approval_state: string;
  registered_on: string;
  link_purpose: string | null;
  other_projects: number;
};

export type ProjectLesson = {
  id: number;
  body: string;
  recorded_on: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
};

export type ProjectDetail = ProjectSummary & {
  created_by_name: string | null;
  created_on: string;
  staff_rows: StaffRow[];
  stakeholders: StakeholderLinkRow[];
  funding_rows: FundingRow[];
  updates: UpdateRow[];
  actions: ActionRow[];
  documents: DocumentRow[];
  lessons: ProjectLesson[];
};

type BaseProjectRow = {
  id: number;
  code: string | null;
  title: string;
  purpose: string | null;
  outcome_summary: string | null;
  status_id: number;
  status_name: string;
  status_position: number;
  is_closed: boolean;
  model_phase_id: number | null;
  phase_order: number | null;
  phase_name: string | null;
  funding_status_id: number | null;
  funding_status_name: string | null;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  updated_on: string;
  areas: NamedRef[];
  tags: NamedRef[];
  created_by_name: string | null;
  created_on: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const getProject = cache(async (id: number): Promise<ProjectDetail | null> => {
  if (!isValidPgInt(id)) return null;
  await ensureSchema();
  const [base] = await sql<BaseProjectRow[]>`
    SELECT p.id, p.code, p.title, p.purpose, p.outcome_summary,
           p.status_id, s.name AS status_name, s.position AS status_position, s.is_closed,
           p.model_phase_id, ph.phase_order, ph.name AS phase_name,
           p.funding_status_id, fs.name AS funding_status_name,
           to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(p.target_end_date, 'YYYY-MM-DD') AS target_end_date,
           to_char(p.actual_end_date, 'YYYY-MM-DD') AS actual_end_date,
           to_char(p.updated_at AT TIME ZONE 'America/Port_of_Spain', 'YYYY-MM-DD') AS updated_on,
           COALESCE((
             SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.position, lower(a.name), a.id)
               FROM project_programme_areas x
               JOIN programme_areas a ON a.id = x.programme_area_id
              WHERE x.project_id = p.id), '[]'::json) AS areas,
           COALESCE((
             SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.position, lower(t.name), t.id)
               FROM project_tags x
               JOIN project_tag_list t ON t.id = x.tag_id
              WHERE x.project_id = p.id), '[]'::json) AS tags,
           cu.name AS created_by_name,
           to_char(p.created_at AT TIME ZONE 'America/Port_of_Spain', 'YYYY-MM-DD') AS created_on
      FROM projects p
      JOIN project_statuses s ON s.id = p.status_id
      LEFT JOIN project_model_phases ph ON ph.id = p.model_phase_id
      LEFT JOIN project_funding_statuses fs ON fs.id = p.funding_status_id
      LEFT JOIN users cu ON cu.id = p.created_by
     WHERE p.id = ${id}`;
  if (!base) return null;

  const [staffRows, stakeholders, fundingRows, updates, actions, documents, lessons] = await Promise.all([
    sql<StaffRow[]>`
      SELECT ps.id, ps.user_id, u.name, (u.status = 'ACTIVE') AS user_active,
             ps.role_id, r.name AS role_name,
             to_char(ps.start_date, 'YYYY-MM-DD') AS start_date,
             to_char(ps.end_date, 'YYYY-MM-DD') AS end_date,
             (ps.end_date IS NULL OR ps.end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date) AS active
        FROM project_staff ps
        JOIN users u ON u.id = ps.user_id
        JOIN project_roles r ON r.id = ps.role_id
       WHERE ps.project_id = ${id}
       ORDER BY active DESC, r.position, lower(u.name), u.id, ps.id`,
    sql<StakeholderLinkRow[]>`
      SELECT x.id, x.stakeholder_id, COALESCE(st.name, x.stakeholder_name) AS name,
             st.organisation, st.email, x.involvement_role,
             to_char(x.start_date, 'YYYY-MM-DD') AS start_date,
             to_char(x.end_date, 'YYYY-MM-DD') AS end_date, x.notes
        FROM project_stakeholders x
        LEFT JOIN stakeholders st ON st.id = x.stakeholder_id
       WHERE x.project_id = ${id}
       ORDER BY lower(COALESCE(st.name, x.stakeholder_name)), x.id`,
    sql<FundingRow[]>`
      SELECT f.id, f.funder_id, COALESCE(st.name, f.funder_name) AS funder, st.organisation AS funder_organisation,
             f.funding_status_id, fs.name AS funding_status_name,
             to_char(f.status_date, 'YYYY-MM-DD') AS status_date,
             f.amount_requested::float8 AS amount_requested,
             f.amount_approved::float8 AS amount_approved,
             f.amount_received::float8 AS amount_received,
             btrim(f.currency_code) AS currency_code, f.notes
        FROM project_funding f
        LEFT JOIN stakeholders st ON st.id = f.funder_id
        LEFT JOIN project_funding_statuses fs ON fs.id = f.funding_status_id
       WHERE f.project_id = ${id}
       ORDER BY btrim(f.currency_code) NULLS LAST, lower(COALESCE(st.name, f.funder_name)), f.id`,
    sql<UpdateRow[]>`
      SELECT u.id, to_char(u.update_date, 'YYYY-MM-DD') AS update_date, u.body, u.recorded_by,
             us.name AS recorded_by_name,
             to_char(u.created_at AT TIME ZONE 'America/Port_of_Spain', 'YYYY-MM-DD HH24:MI') AS entered_at
        FROM project_updates u
        LEFT JOIN users us ON us.id = u.recorded_by
       WHERE u.project_id = ${id}
       ORDER BY u.update_date DESC, u.id DESC`,
    sql<ActionRow[]>`
      SELECT a.id, a.description, a.assigned_user_id, us.name AS assigned_name,
             to_char(a.due_date, 'YYYY-MM-DD') AS due_date, a.state,
             to_char(a.completed_on, 'YYYY-MM-DD') AS completed_on
        FROM project_actions a
        LEFT JOIN users us ON us.id = a.assigned_user_id
       WHERE a.project_id = ${id}
       ORDER BY (a.state IN ('DONE', 'CANCELLED')), a.due_date NULLS LAST, a.id`,
    sql<DocumentRow[]>`
      SELECT r.id AS resource_id, r.title, r.resource_type, r.url, r.version_label, r.approval_state,
             to_char(r.registered_on, 'YYYY-MM-DD') AS registered_on, d.link_purpose,
             COALESCE(oc.other_projects, 0)::int AS other_projects
        FROM project_documents d
        JOIN document_resources r ON r.id = d.resource_id
        LEFT JOIN (
          SELECT resource_id, COUNT(*)::int AS other_projects
            FROM project_documents
           WHERE project_id <> ${id}
           GROUP BY resource_id
        ) oc ON oc.resource_id = r.id
       WHERE d.project_id = ${id}
       ORDER BY (r.approval_state = 'FINAL') DESC, lower(r.title), r.id`,
    sql<ProjectLesson[]>`
      SELECT l.id, l.body, to_char(l.recorded_on, 'YYYY-MM-DD') AS recorded_on, l.recorded_by,
             us.name AS recorded_by_name
        FROM project_lessons l
        LEFT JOIN users us ON us.id = l.recorded_by
       WHERE l.project_id = ${id}
       ORDER BY l.recorded_on DESC, l.id DESC`,
  ]);

  const today = astTodayKey();
  const openActionRows = actions.filter((a) => a.state === "OPEN" || a.state === "IN_PROGRESS");
  const overdueActions = openActionRows.filter((a) => a.due_date !== null && a.due_date < today).length;

  const fundingByCurrency = new Map<string, CurrencyTotal>();
  for (const f of fundingRows) {
    const code = f.currency_code?.trim();
    if (!code) continue;
    const entry = fundingByCurrency.get(code) ?? {
      currency: code,
      requested: 0,
      approved: 0,
      received: 0,
      has_approved: false,
    };
    entry.requested = round2(entry.requested + (f.amount_requested ?? 0));
    entry.approved = round2(entry.approved + (f.amount_approved ?? 0));
    entry.received = round2(entry.received + (f.amount_received ?? 0));
    if (f.amount_approved !== null) entry.has_approved = true;
    fundingByCurrency.set(code, entry);
  }
  const funding = [...fundingByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    ...base,
    staff: staffRows
      .filter((s) => s.active)
      .map((s) => ({ user_id: s.user_id, name: s.name, role: s.role_name })),
    open_actions: openActionRows.length,
    overdue_actions: overdueActions,
    update_count: updates.length,
    last_update_date: updates[0]?.update_date ?? null,
    last_update_body: updates[0]?.body ?? null,
    lesson_count: lessons.length,
    stakeholder_count: stakeholders.length,
    funding,
    staff_rows: staffRows,
    stakeholders,
    funding_rows: fundingRows,
    updates,
    actions,
    documents,
    lessons,
  };
});

export type StakeholderOption = { id: number; name: string; organisation: string | null };

export const listStakeholderOptions = cache(async (): Promise<StakeholderOption[]> => {
  await ensureSchema();
  return sql<StakeholderOption[]>`
    SELECT id, name, organisation FROM stakeholders ORDER BY lower(name), id`;
});

export type ResourceOption = { id: number; title: string; resource_type: string | null };

/** Documents already registered against other projects, for linking (BR-15). */
export const listResourceOptions = cache(async (excludeProjectId: number): Promise<ResourceOption[]> => {
  if (!isValidPgInt(excludeProjectId)) return [];
  await ensureSchema();
  return sql<ResourceOption[]>`
    SELECT r.id, r.title, r.resource_type
      FROM document_resources r
     WHERE NOT EXISTS (
       SELECT 1 FROM project_documents d WHERE d.resource_id = r.id AND d.project_id = ${excludeProjectId})
     ORDER BY lower(r.title), r.id`;
});

/** Someone currently assigned may add updates and lessons and close their own actions. */
export const isAssignedToProject = cache(async (projectId: number, userId: number): Promise<boolean> => {
  if (!isValidPgInt(projectId) || !isValidPgInt(userId)) return false;
  await ensureSchema();
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM project_staff
       WHERE project_id = ${projectId} AND user_id = ${userId}
         AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date)
    ) AS ok`;
  return Boolean(row?.ok);
});

/** Projects the given person is currently assigned to, for "My projects". */
export const listProjectIdsForUser = cache(async (userId: number): Promise<number[]> => {
  if (!isValidPgInt(userId)) return [];
  await ensureSchema();
  const rows = await sql<{ project_id: number }[]>`
    SELECT DISTINCT project_id FROM project_staff
     WHERE user_id = ${userId}
       AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date)
     ORDER BY project_id`;
  return rows.map((r) => r.project_id);
});

export type StakeholderProjectLink = {
  id: number;
  project_id: number;
  code: string | null;
  title: string;
  status_name: string;
  status_position: number;
  is_closed: boolean;
  involvement_role: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type StakeholderFundingLink = {
  id: number;
  project_id: number;
  project_code: string | null;
  project_title: string;
  funding_status_name: string | null;
  status_date: string | null;
  amount_requested: number | null;
  amount_approved: number | null;
  amount_received: number | null;
  currency_code: string | null;
};

export type StakeholderProjectsSummary = {
  projects: StakeholderProjectLink[];
  funding: StakeholderFundingLink[];
};

/** Projects and funding records referencing a stakeholder, for `/stakeholders/[id]`. */
export const listProjectsForStakeholder = cache(
  async (stakeholderId: number): Promise<StakeholderProjectsSummary> => {
    if (!isValidPgInt(stakeholderId)) return { projects: [], funding: [] };
    await ensureSchema();
    const [projects, funding] = await Promise.all([
      sql<StakeholderProjectLink[]>`
        SELECT x.id, p.id AS project_id, p.code, p.title,
               s.name AS status_name, s.position AS status_position, s.is_closed,
               x.involvement_role,
               to_char(x.start_date, 'YYYY-MM-DD') AS start_date,
               to_char(x.end_date, 'YYYY-MM-DD') AS end_date
          FROM project_stakeholders x
          JOIN projects p ON p.id = x.project_id
          JOIN project_statuses s ON s.id = p.status_id
         WHERE x.stakeholder_id = ${stakeholderId}
         ORDER BY s.is_closed, s.position, lower(p.title), x.id`,
      sql<StakeholderFundingLink[]>`
        SELECT f.id, p.id AS project_id, p.code AS project_code, p.title AS project_title,
               fs.name AS funding_status_name,
               to_char(f.status_date, 'YYYY-MM-DD') AS status_date,
               f.amount_requested::float8 AS amount_requested,
               f.amount_approved::float8 AS amount_approved,
               f.amount_received::float8 AS amount_received,
               btrim(f.currency_code) AS currency_code
          FROM project_funding f
          JOIN projects p ON p.id = f.project_id
          LEFT JOIN project_funding_statuses fs ON fs.id = f.funding_status_id
         WHERE f.funder_id = ${stakeholderId}
         ORDER BY lower(p.title), f.id`,
    ]);
    return { projects, funding };
  },
);
