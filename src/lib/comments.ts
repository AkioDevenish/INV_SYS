import "server-only";
import { sql } from "./db";
import { ensureSchema } from "./setup";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";

export type CommentEntity = "project" | "task";

export type CommentRow = {
  id: number;
  author_id: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
  edited: boolean;
};

export type Mentionable = { id: number; name: string };

/** Comments follow the record's own view permission. */
export async function canSeeEntity(user: CurrentUser, type: CommentEntity): Promise<boolean> {
  return can(user.role, type === "project" ? "projects.view" : "timelines.view");
}

export async function entityExists(type: CommentEntity, id: number): Promise<{ title: string } | null> {
  const rows =
    type === "project"
      ? await sql<{ title: string }[]>`SELECT title FROM projects WHERE id = ${id}`
      : await sql<{ title: string }[]>`SELECT title FROM staff_tasks WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function listComments(type: CommentEntity, id: number): Promise<CommentRow[]> {
  await ensureSchema();
  return sql<CommentRow[]>`
    SELECT c.id, c.author_id, u.name AS author_name, c.body,
           to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           (c.edited_at IS NOT NULL) AS edited
      FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.entity_type = ${type} AND c.entity_id = ${id}
     ORDER BY c.created_at, c.id`;
}

export async function listMentionable(): Promise<Mentionable[]> {
  return sql<Mentionable[]>`SELECT id, name FROM users WHERE status = 'ACTIVE' ORDER BY lower(name)`;
}

/** People named as "@Full Name" in the text, longest names first so "@Ann Marie" beats "@Ann". */
export function findMentions(body: string, people: Mentionable[]): number[] {
  const lower = body.toLowerCase();
  const found = new Set<number>();
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${p.name.toLowerCase()}`;
    let i = lower.indexOf(needle);
    while (i !== -1) {
      const after = lower[i + needle.length];
      if (after === undefined || !/[a-z0-9]/.test(after)) {
        found.add(p.id);
        break;
      }
      i = lower.indexOf(needle, i + 1);
    }
  }
  return [...found];
}
