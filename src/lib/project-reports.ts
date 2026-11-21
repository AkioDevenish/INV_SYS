import "server-only";
import { cache } from "react";
import { sql } from "./db";
import { ensureSchema } from "./setup";

/**
 * Portfolio figures for Projects → Reports. Every total is calculated from the
 * underlying records at request time, and money is only ever summed within one
 * currency (BR-12).
 */

const TODAY = `(now() AT TIME ZONE 'America/Port_of_Spain')::date`;

export type PortfolioTotals = {
  total: number;
  open: number;
  closed: number;
  past_target: number;
  no_phase: number;
  open_actions: number;
  overdue_actions: number;
  lessons: number;
};

export type CountRow = { id: number | null; name: string; position: number; count: number; closed?: boolean };

export type CurrencyFunding = {
  currency: string;
  arrangements: number;
  projects: number;
  requested: number;
  approved: number;
  received: number;
};

export type FunderRow = {
  funder: string;
  currency: string;
  projects: number;
  approved: number;
  received: number;
};

export type PersonActions = {
  user_id: number | null;
  name: string;
  open: number;
  overdue: number;
  due_soon: number;
  oldest_overdue: string | null;
};

export type ProjectReport = {
  totals: PortfolioTotals;
  byStatus: CountRow[];
  byPhase: CountRow[];
  byArea: CountRow[];
  funding: CurrencyFunding[];
  funders: FunderRow[];
  actionsByPerson: PersonActions[];
};

export const getProjectReport = cache(async (): Promise<ProjectReport> => {
  await ensureSchema();
  const [totals, byStatus, byPhase, byArea, funding, funders, actionsByPerson] = await Promise.all([
    sql.unsafe<PortfolioTotals[]>(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE NOT s.is_closed)::int AS open,
             COUNT(*) FILTER (WHERE s.is_closed)::int AS closed,
             COUNT(*) FILTER (WHERE NOT s.is_closed AND p.actual_end_date IS NULL
                                AND p.target_end_date < ${TODAY})::int AS past_target,
             COUNT(*) FILTER (WHERE p.model_phase_id IS NULL AND NOT s.is_closed)::int AS no_phase,
             (SELECT COUNT(*)::int FROM project_actions WHERE state IN ('OPEN', 'IN_PROGRESS')) AS open_actions,
             (SELECT COUNT(*)::int FROM project_actions
               WHERE state IN ('OPEN', 'IN_PROGRESS') AND due_date < ${TODAY}) AS overdue_actions,
             (SELECT COUNT(*)::int FROM project_lessons) AS lessons
        FROM projects p JOIN project_statuses s ON s.id = p.status_id`),
    sql<CountRow[]>`
      SELECT s.id, s.name, s.position, s.is_closed AS closed, COUNT(p.id)::int AS count
        FROM project_statuses s LEFT JOIN projects p ON p.status_id = s.id
       GROUP BY s.id ORDER BY s.position, s.name`,
    sql.unsafe<CountRow[]>(`
      SELECT m.id, m.name, m.phase_order AS position,
             (COUNT(p.id) FILTER (WHERE NOT s.is_closed))::int AS count
        FROM project_model_phases m
        LEFT JOIN projects p ON p.model_phase_id = m.id
        LEFT JOIN project_statuses s ON s.id = p.status_id
       GROUP BY m.id
      UNION ALL
      SELECT NULL, 'No phase yet', 99, COUNT(*)::int
        FROM projects p JOIN project_statuses s ON s.id = p.status_id
       WHERE p.model_phase_id IS NULL AND NOT s.is_closed
       ORDER BY 3`),
    sql<CountRow[]>`
      SELECT a.id, a.name, a.position, COUNT(x.project_id)::int AS count
        FROM programme_areas a LEFT JOIN project_programme_areas x ON x.programme_area_id = a.id
       GROUP BY a.id ORDER BY COUNT(x.project_id) DESC, a.position, a.name`,
    sql<CurrencyFunding[]>`
      SELECT btrim(currency_code) AS currency,
             COUNT(*)::int AS arrangements,
             COUNT(DISTINCT project_id)::int AS projects,
             COALESCE(SUM(amount_requested), 0)::float8 AS requested,
             COALESCE(SUM(amount_approved), 0)::float8 AS approved,
             COALESCE(SUM(amount_received), 0)::float8 AS received
        FROM project_funding
       WHERE currency_code IS NOT NULL
       GROUP BY btrim(currency_code)
       ORDER BY COALESCE(SUM(amount_approved), 0) DESC`,
    sql<FunderRow[]>`
      SELECT COALESCE(st.organisation, st.name, f.funder_name) AS funder,
             btrim(f.currency_code) AS currency,
             COUNT(DISTINCT f.project_id)::int AS projects,
             COALESCE(SUM(f.amount_approved), 0)::float8 AS approved,
             COALESCE(SUM(f.amount_received), 0)::float8 AS received
        FROM project_funding f
        LEFT JOIN stakeholders st ON st.id = f.funder_id
       WHERE f.currency_code IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 4 DESC, 1
       LIMIT 12`,
    sql.unsafe<PersonActions[]>(`
      SELECT a.assigned_user_id AS user_id, COALESCE(u.name, 'Unassigned') AS name,
             COUNT(*)::int AS open,
             COUNT(*) FILTER (WHERE a.due_date < ${TODAY})::int AS overdue,
             COUNT(*) FILTER (WHERE a.due_date >= ${TODAY} AND a.due_date <= ${TODAY} + 14)::int AS due_soon,
             to_char(MIN(a.due_date) FILTER (WHERE a.due_date < ${TODAY}), 'YYYY-MM-DD') AS oldest_overdue
        FROM project_actions a
        LEFT JOIN users u ON u.id = a.assigned_user_id
       WHERE a.state IN ('OPEN', 'IN_PROGRESS')
       GROUP BY a.assigned_user_id, u.name
       ORDER BY overdue DESC, open DESC, name`),
  ]);

  return {
    totals: totals[0] ?? {
      total: 0, open: 0, closed: 0, past_target: 0, no_phase: 0, open_actions: 0, overdue_actions: 0, lessons: 0,
    },
    byStatus,
    byPhase,
    byArea,
    funding,
    funders,
    actionsByPerson,
  };
});

export type ProjectAtRisk = {
  id: number;
  code: string | null;
  title: string;
  target_end_date: string | null;
  days_late: number | null;
  overdue_actions: number;
};

/** Open projects past their target end, or carrying overdue follow-up actions. */
export const listProjectsAtRisk = cache(async (): Promise<ProjectAtRisk[]> => {
  await ensureSchema();
  return sql.unsafe<ProjectAtRisk[]>(`
    SELECT p.id, p.code, p.title,
           to_char(p.target_end_date, 'YYYY-MM-DD') AS target_end_date,
           CASE WHEN p.actual_end_date IS NULL AND p.target_end_date < ${TODAY}
                THEN (${TODAY} - p.target_end_date) END AS days_late,
           (SELECT COUNT(*)::int FROM project_actions a
             WHERE a.project_id = p.id AND a.state IN ('OPEN', 'IN_PROGRESS') AND a.due_date < ${TODAY}) AS overdue_actions
      FROM projects p JOIN project_statuses s ON s.id = p.status_id
     WHERE NOT s.is_closed
       AND ((p.actual_end_date IS NULL AND p.target_end_date < ${TODAY})
            OR EXISTS (SELECT 1 FROM project_actions a
                        WHERE a.project_id = p.id AND a.state IN ('OPEN', 'IN_PROGRESS') AND a.due_date < ${TODAY}))
     ORDER BY days_late DESC NULLS LAST, overdue_actions DESC, lower(p.title)
     LIMIT 8`);
});
