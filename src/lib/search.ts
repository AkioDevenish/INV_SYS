import "server-only";
import { sql } from "./db";
import { ensureSchema } from "./setup";
import { canWith, type PermissionMatrix, type Role } from "./roles";
import { areaLabel } from "./timelines";

/**
 * App-wide search behind the ⌘K palette. Each section only runs if the
 * person's role can open that part of the app, so search never shows a
 * record its page would refuse.
 */

export type SearchKind =
  | "project"
  | "task"
  | "action"
  | "lesson"
  | "event"
  | "stakeholder"
  | "vendor"
  | "item"
  | "user";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

const PER_GROUP = 5;

const GROUP_LABELS: Record<SearchKind, string> = {
  project: "Projects",
  action: "Project actions",
  lesson: "Lessons",
  task: "Timelines",
  event: "Calendar",
  stakeholder: "Stakeholders",
  vendor: "Vendors",
  item: "Inventory",
  user: "People",
};

/** Escapes LIKE wildcards so a typed % or _ is matched literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function monthOf(iso: string): string {
  return new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toISOString().slice(0, 7);
}

export async function searchEverything(
  rawQuery: string,
  matrix: PermissionMatrix,
  role: Role,
): Promise<SearchGroup[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  await ensureSchema();
  const p = likePattern(q);
  const can = (perm: Parameters<typeof canWith>[2]) => canWith(matrix, role, perm);

  const jobs: Promise<SearchHit[]>[] = [];

  if (can("projects.view")) {
    jobs.push(
      sql<{ id: number; code: string | null; title: string; status: string }[]>`
        SELECT p.id, p.code, p.title, s.name AS status
          FROM projects p JOIN project_statuses s ON s.id = p.status_id
         WHERE p.title ILIKE ${p} OR p.code ILIKE ${p} OR p.purpose ILIKE ${p} OR p.outcome_summary ILIKE ${p}
         ORDER BY (p.title ILIKE ${q + "%"}) DESC, s.is_closed, lower(p.title)
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "project" as const,
          id: `p${r.id}`,
          title: r.title,
          subtitle: [r.code, r.status].filter(Boolean).join(" · "),
          href: `/projects/${r.id}`,
        })),
      ),
      sql<{ id: number; project_id: number; description: string; project: string; who: string | null }[]>`
        SELECT a.id, a.project_id, a.description, p.title AS project, u.name AS who
          FROM project_actions a
          JOIN projects p ON p.id = a.project_id
          LEFT JOIN users u ON u.id = a.assigned_user_id
         WHERE a.description ILIKE ${p} AND a.state IN ('OPEN', 'IN_PROGRESS')
         ORDER BY a.due_date NULLS LAST
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "action" as const,
          id: `a${r.id}`,
          title: r.description,
          subtitle: [r.project, r.who].filter(Boolean).join(" · "),
          href: `/projects/${r.project_id}?tab=actions`,
        })),
      ),
      sql<{ id: number; project_id: number; body: string; project: string }[]>`
        SELECT l.id, l.project_id, l.body, p.title AS project
          FROM project_lessons l JOIN projects p ON p.id = l.project_id
         WHERE l.body ILIKE ${p}
         ORDER BY l.recorded_on DESC
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "lesson" as const,
          id: `l${r.id}`,
          title: r.body.length > 110 ? `${r.body.slice(0, 110)}…` : r.body,
          subtitle: r.project,
          href: `/projects/${r.project_id}?tab=lessons`,
        })),
      ),
    );
  }

  if (can("timelines.view")) {
    jobs.push(
      sql<{ id: number; title: string; area: string; lead: string | null; owner: string | null }[]>`
        SELECT t.id, t.title, t.area, t.lead, u.name AS owner
          FROM staff_tasks t LEFT JOIN users u ON u.id = t.owner_id
         WHERE t.title ILIKE ${p} OR t.comments ILIKE ${p} OR t.lead ILIKE ${p} OR u.name ILIKE ${p}
         ORDER BY (t.status = 'COMPLETE'), (t.title ILIKE ${q + "%"}) DESC, t.id
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "task" as const,
          id: `t${r.id}`,
          title: r.title,
          subtitle: [areaLabel(r.area), r.owner ?? r.lead].filter(Boolean).join(" · "),
          href: `/timelines?q=${encodeURIComponent(r.title.slice(0, 60))}`,
        })),
      ),
    );
  }

  if (can("calendar.view")) {
    jobs.push(
      sql<{ id: number; title: string; starts_at: Date; location: string | null }[]>`
        SELECT id, title, starts_at, location
          FROM calendar_events
         WHERE title ILIKE ${p} OR description ILIKE ${p} OR location ILIKE ${p}
         ORDER BY (starts_at >= now() - interval '1 day') DESC,
                  abs(extract(epoch FROM starts_at - now()))
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => {
          const iso = r.starts_at.toISOString();
          const when = new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          });
          return {
            kind: "event" as const,
            id: `e${r.id}`,
            title: r.title,
            subtitle: [when, r.location].filter(Boolean).join(" · "),
            href: `/calendar?month=${monthOf(iso)}`,
          };
        }),
      ),
    );
  }

  if (can("stakeholders.view")) {
    jobs.push(
      sql<{ id: number; name: string; organisation: string | null; job_title: string | null }[]>`
        SELECT id, name, organisation, job_title
          FROM stakeholders
         WHERE name ILIKE ${p} OR organisation ILIKE ${p} OR email ILIKE ${p} OR job_title ILIKE ${p}
         ORDER BY (name ILIKE ${q + "%"}) DESC, lower(name)
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "stakeholder" as const,
          id: `s${r.id}`,
          title: r.name,
          subtitle: [r.job_title, r.organisation].filter(Boolean).join(" · ") || null,
          href: `/stakeholders/${r.id}`,
        })),
      ),
      sql<{ id: number; name: string; category: string; service: string | null }[]>`
        SELECT id, name, category, service
          FROM vendors
         WHERE name ILIKE ${p} OR service ILIKE ${p} OR category ILIKE ${p} OR contact_person ILIKE ${p}
         ORDER BY (name ILIKE ${q + "%"}) DESC, lower(name)
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "vendor" as const,
          id: `v${r.id}`,
          title: r.name,
          subtitle: [r.category, r.service].filter(Boolean).join(" · "),
          href: `/vendors?q=${encodeURIComponent(r.name)}`,
        })),
      ),
    );
  }

  if (can("inventory.view")) {
    jobs.push(
      sql<{ id: number; name: string; sku: string | null; location: string | null }[]>`
        SELECT i.id, i.name, i.sku, l.name AS location
          FROM items i LEFT JOIN locations l ON l.id = i.location_id
         WHERE i.name ILIKE ${p} OR i.sku ILIKE ${p} OR i.supplier ILIKE ${p} OR i.description ILIKE ${p}
         ORDER BY (i.name ILIKE ${q + "%"}) DESC, lower(i.name)
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "item" as const,
          id: `i${r.id}`,
          title: r.name,
          subtitle: [r.sku, r.location].filter(Boolean).join(" · ") || null,
          href: `/inventory/${r.id}`,
        })),
      ),
    );
  }

  if (can("users.manage")) {
    jobs.push(
      sql<{ id: number; name: string; email: string; role: string }[]>`
        SELECT id, name, email, role FROM users
         WHERE name ILIKE ${p} OR email ILIKE ${p}
         ORDER BY lower(name)
         LIMIT ${PER_GROUP}`.then((rows) =>
        rows.map((r) => ({
          kind: "user" as const,
          id: `u${r.id}`,
          title: r.name,
          subtitle: r.email,
          href: `/users?q=${encodeURIComponent(r.email)}`,
        })),
      ),
    );
  }

  const results = (await Promise.all(jobs)).flat();
  const order: SearchKind[] = ["project", "action", "task", "event", "stakeholder", "vendor", "item", "lesson", "user"];
  return order
    .map((kind) => ({ kind, label: GROUP_LABELS[kind], hits: results.filter((h) => h.kind === kind) }))
    .filter((g) => g.hits.length > 0);
}
