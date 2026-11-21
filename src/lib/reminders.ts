import "server-only";
import { sql } from "./db";
import { ensureSchema } from "./setup";
import { areaLabel } from "./timelines";
import { isMailConfigured, sendMail } from "./microsoft";
import { APP_NAME } from "./brand";

/**
 * The weekly reminder email: for each person, the timeline tasks they own and
 * the project actions assigned to them that are overdue or due in the next
 * seven days. Nobody gets an empty email, and nobody gets two in one week.
 */

const TODAY = `(now() AT TIME ZONE 'America/Port_of_Spain')::date`;
const LOOKAHEAD_DAYS = 7;

export type DigestItem = {
  kind: "task" | "action";
  title: string;
  context: string;
  due: string;
  overdue: boolean;
  path: string;
};

export type Digest = {
  userId: number;
  name: string;
  email: string;
  overdue: DigestItem[];
  upcoming: DigestItem[];
};

type Row = {
  user_id: number;
  kind: "task" | "action";
  title: string;
  context: string | null;
  area: string | null;
  due: string;
  overdue: boolean;
  ref: number;
};

async function loadItems(userId?: number): Promise<Row[]> {
  const filter = userId ? `AND u.id = ${Number(userId)}` : "";
  return sql.unsafe<Row[]>(`
    SELECT u.id AS user_id, 'task' AS kind, t.title, NULL AS context, t.area,
           to_char(COALESCE(t.ends_on, t.starts_on), 'YYYY-MM-DD') AS due,
           COALESCE(t.ends_on, t.starts_on) < ${TODAY} AS overdue, t.id AS ref
      FROM staff_tasks t JOIN users u ON u.id = t.owner_id
     WHERE t.status <> 'COMPLETE'
       AND COALESCE(t.ends_on, t.starts_on) <= ${TODAY} + ${LOOKAHEAD_DAYS}
       AND u.status = 'ACTIVE' ${filter}
    UNION ALL
    SELECT u.id, 'action', a.description, COALESCE(p.code || ' · ', '') || p.title, NULL,
           to_char(a.due_date, 'YYYY-MM-DD'), a.due_date < ${TODAY}, p.id
      FROM project_actions a
      JOIN projects p ON p.id = a.project_id
      JOIN users u ON u.id = a.assigned_user_id
     WHERE a.state IN ('OPEN', 'IN_PROGRESS')
       AND a.due_date <= ${TODAY} + ${LOOKAHEAD_DAYS}
       AND u.status = 'ACTIVE' ${filter}
     ORDER BY 6, 3`);
}

function toItem(r: Row): DigestItem {
  return {
    kind: r.kind,
    title: r.title,
    context: r.kind === "task" ? `Timelines · ${areaLabel(r.area ?? "")}` : `Project · ${r.context ?? ""}`,
    due: r.due,
    overdue: r.overdue,
    path: r.kind === "task" ? "/timelines?mine=1" : `/projects/${r.ref}?tab=actions`,
  };
}

export async function getDigestFor(userId: number): Promise<Digest | null> {
  await ensureSchema();
  const [user] = await sql<{ id: number; name: string; email: string }[]>`
    SELECT id, name, email FROM users WHERE id = ${userId}`;
  if (!user) return null;
  const items = (await loadItems(userId)).map(toItem);
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    overdue: items.filter((i) => i.overdue),
    upcoming: items.filter((i) => !i.overdue),
  };
}

/* ---------- email layout ---------- */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function appUrl(): string | null {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

function dayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function section(title: string, colour: string, items: DigestItem[], base: string | null): string {
  if (!items.length) return "";
  const rows = items
    .map((i) => {
      const titleHtml = base
        ? `<a href="${esc(base + i.path)}" style="color:#16243a;text-decoration:none;font-weight:600">${esc(i.title)}</a>`
        : `<span style="font-weight:600">${esc(i.title)}</span>`;
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e8ecf2;font-size:14px;line-height:1.4">
          ${titleHtml}<br><span style="color:#6b7686;font-size:12px">${esc(i.context)}</span>
        </td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #e8ecf2;font-size:12px;white-space:nowrap;text-align:right;color:${colour};font-weight:600">
          ${esc(dayLabel(i.due))}
        </td>
      </tr>`;
    })
    .join("");
  return `<h2 style="margin:24px 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${colour}">${esc(title)} · ${items.length}</h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>`;
}

export function renderDigestEmail(d: Digest): { subject: string; html: string } {
  const base = appUrl();
  const first = d.name.split(/\s+/)[0] || d.name;
  const parts = [
    d.overdue.length ? `${d.overdue.length} overdue` : null,
    d.upcoming.length ? `${d.upcoming.length} due this week` : null,
  ].filter(Boolean);
  const subject = `Your week: ${parts.join(", ")}`;
  const button = base
    ? `<p style="margin:28px 0 0"><a href="${esc(base)}/timelines?mine=1" style="display:inline-block;background:#14477d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">Open my timelines</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16243a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e3e8ef;border-radius:16px">
      <tr><td style="padding:28px 28px 8px">
        <div style="font-size:12px;font-weight:600;color:#14477d">${esc(APP_NAME)}</div>
        <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3">Good morning, ${esc(first)}</h1>
        <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#4b5565">Here's what's on your plate this week.</p>
      </td></tr>
      <tr><td style="padding:0 28px 28px">
        ${section("Overdue", "#be123c", d.overdue, base)}
        ${section("Due in the next 7 days", "#14477d", d.upcoming, base)}
        ${button}
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#8a94a3">Sent every Monday. You can turn these off on your profile page.</p>
  </td></tr></table></body></html>`;
  return { subject, html };
}

/* ---------- sending ---------- */

export type ReminderRun = {
  sent: number;
  skippedRecent: number;
  nothingDue: number;
  failed: { email: string; error: string }[];
  notConfigured?: boolean;
};

/**
 * Sends this week's reminders. `force` ignores the once-a-week guard and
 * `onlyUserId` limits the run to one person (used by "Send me a test").
 */
export async function sendWeeklyReminders(opts: { force?: boolean; onlyUserId?: number } = {}): Promise<ReminderRun> {
  await ensureSchema();
  const run: ReminderRun = { sent: 0, skippedRecent: 0, nothingDue: 0, failed: [] };
  if (!isMailConfigured()) return { ...run, notConfigured: true };

  const users = await sql<{ id: number; name: string; email: string; recent: boolean }[]>`
    SELECT u.id, u.name, u.email,
           EXISTS (SELECT 1 FROM reminder_log l
                    WHERE l.user_id = u.id AND l.status = 'SENT' AND l.sent_at > now() - interval '6 days') AS recent
      FROM users u
     WHERE u.status = 'ACTIVE'
       AND (${opts.onlyUserId ?? null}::int IS NULL OR u.id = ${opts.onlyUserId ?? null})
       AND (${Boolean(opts.onlyUserId)} OR u.reminders_enabled)`;

  const allItems = await loadItems(opts.onlyUserId);
  const byUser = new Map<number, DigestItem[]>();
  for (const r of allItems) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(toItem(r));
    byUser.set(r.user_id, list);
  }

  for (const u of users) {
    if (u.recent && !opts.force) {
      run.skippedRecent++;
      continue;
    }
    const items = byUser.get(u.id) ?? [];
    if (!items.length) {
      run.nothingDue++;
      continue;
    }
    const digest: Digest = {
      userId: u.id,
      name: u.name,
      email: u.email,
      overdue: items.filter((i) => i.overdue),
      upcoming: items.filter((i) => !i.overdue),
    };
    const { subject, html } = renderDigestEmail(digest);
    const result = await sendMail({ to: u.email, subject, html });
    await sql`
      INSERT INTO reminder_log (user_id, item_count, status, error)
      VALUES (${u.id}, ${items.length}, ${result.ok ? "SENT" : "FAILED"}, ${result.ok ? null : result.error.slice(0, 500)})`;
    if (result.ok) run.sent++;
    else run.failed.push({ email: u.email, error: result.error });
  }
  return run;
}

export async function lastReminderFor(userId: number): Promise<{ sent_at: string; status: string } | null> {
  await ensureSchema();
  const [row] = await sql<{ sent_at: string; status: string }[]>`
    SELECT to_char(sent_at AT TIME ZONE 'America/Port_of_Spain', 'YYYY-MM-DD') AS sent_at, status
      FROM reminder_log WHERE user_id = ${userId} ORDER BY sent_at DESC LIMIT 1`;
  return row ?? null;
}
