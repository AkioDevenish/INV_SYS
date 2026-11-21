import "server-only";
import { sql } from "./db";
import { ensureSchema } from "./setup";
import type { SqlExecutor } from "./auth";

/**
 * In-app notifications: the bell in the sidebar. Assignments and mentions
 * create them as they happen; overdue alerts are raised when the bell is
 * opened, at most once per item per due date (dedupe_key).
 */

export type NotificationKind =
  | "task_assigned"
  | "action_assigned"
  | "project_added"
  | "mention"
  | "comment"
  | "overdue";

export type NotificationRow = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  actor_name: string | null;
  read: boolean;
  created_at: string;
};

const TODAY = `(now() AT TIME ZONE 'America/Port_of_Spain')::date`;

/** Never notifies people about their own actions. Safe to call inside a transaction. */
export async function notify(
  input: {
    userId: number | null | undefined;
    actorId?: number | null;
    kind: NotificationKind;
    title: string;
    body?: string | null;
    href?: string | null;
    dedupeKey?: string | null;
  },
  tx?: SqlExecutor,
): Promise<void> {
  if (!input.userId || input.userId === input.actorId) return;
  const db = tx ?? sql;
  await db`
    INSERT INTO notifications (user_id, kind, title, body, href, actor_id, dedupe_key)
    SELECT ${input.userId}, ${input.kind}, ${input.title.slice(0, 300)}, ${input.body?.slice(0, 500) ?? null},
           ${input.href ?? null}, ${input.actorId ?? null}, ${input.dedupeKey ?? null}
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ${input.userId} AND status = 'ACTIVE')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
}

/** Raises one "overdue" alert per overdue task or action the person is responsible for. */
async function raiseOverdue(userId: number): Promise<void> {
  await sql.unsafe(
    `
    INSERT INTO notifications (user_id, kind, title, body, href, dedupe_key)
    SELECT $1, 'overdue', 'Overdue: ' || left(t.title, 200),
           'This timeline task was due ' || to_char(COALESCE(t.ends_on, t.starts_on), 'FMDD Mon YYYY') || '.',
           '/timelines?mine=1&status=OVERDUE',
           'overdue-task-' || t.id || '-' || COALESCE(t.ends_on, t.starts_on)
      FROM staff_tasks t
     WHERE t.owner_id = $1 AND t.status <> 'COMPLETE' AND COALESCE(t.ends_on, t.starts_on) < ${TODAY}
       AND COALESCE(t.ends_on, t.starts_on) >= ${TODAY} - 60
    UNION ALL
    SELECT $1, 'overdue', 'Overdue: ' || left(a.description, 200),
           'Follow-up action on ' || p.title || ', due ' || to_char(a.due_date, 'FMDD Mon YYYY') || '.',
           '/projects/' || p.id || '?tab=actions',
           'overdue-action-' || a.id || '-' || a.due_date
      FROM project_actions a JOIN projects p ON p.id = a.project_id
     WHERE a.assigned_user_id = $1 AND a.state IN ('OPEN', 'IN_PROGRESS') AND a.due_date < ${TODAY}
       AND a.due_date >= ${TODAY} - 60
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [userId],
  );
}

export async function listNotifications(
  userId: number,
): Promise<{ items: NotificationRow[]; unread: number }> {
  await ensureSchema();
  await raiseOverdue(userId);
  const [items, [count]] = await Promise.all([
    sql<NotificationRow[]>`
      SELECT n.id, n.kind, n.title, n.body, n.href, a.name AS actor_name,
             (n.read_at IS NOT NULL) AS read,
             to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = ${userId}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 40`,
    sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`,
  ]);
  return { items, unread: count?.n ?? 0 };
}

export async function markNotificationsRead(userId: number, id?: number): Promise<void> {
  if (id) {
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND id = ${id} AND read_at IS NULL`;
  } else {
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`;
  }
}

/** Keeps the table small: read alerts older than 90 days are dropped. */
export async function pruneNotifications(): Promise<void> {
  await sql`DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days'`;
}
