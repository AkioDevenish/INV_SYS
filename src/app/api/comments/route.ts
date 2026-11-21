import { NextResponse } from "next/server";
import { recordAudit, requireApiUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { sql } from "@/lib/db";
import { notify } from "@/lib/notifications";
import {
  canSeeEntity,
  entityExists,
  findMentions,
  listComments,
  listMentionable,
  type CommentEntity,
} from "@/lib/comments";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

function parseTarget(type: unknown, id: unknown): { type: CommentEntity; id: number } | null {
  const n = Number(id);
  if ((type !== "project" && type !== "task") || !Number.isSafeInteger(n) || n < 1) return null;
  return { type, id: n };
}

async function moderator(role: Parameters<typeof can>[0], type: CommentEntity) {
  return can(role, type === "project" ? "projects.manage" : "timelines.manage");
}

export async function GET(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const target = parseTarget(url.searchParams.get("type"), url.searchParams.get("id"));
  if (!target) return json({ error: "Invalid record." }, 400);
  if (!(await canSeeEntity(auth.user, target.type))) return json({ error: "Forbidden." }, 403);
  const [comments, people, canModerate] = await Promise.all([
    listComments(target.type, target.id),
    listMentionable(),
    moderator(auth.user.role, target.type),
  ]);
  return json({ comments, people, currentUserId: auth.user.userId, canModerate });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Expected JSON." }, 415);
  const input = (await req.json().catch(() => ({}))) as { type?: unknown; id?: unknown; body?: unknown };
  const target = parseTarget(input.type, input.id);
  const body = typeof input.body === "string" ? input.body.trim().slice(0, 4000) : "";
  if (!target) return json({ error: "Invalid record." }, 400);
  if (!body) return json({ error: "Write something first." }, 400);
  if (!(await canSeeEntity(auth.user, target.type))) return json({ error: "Forbidden." }, 403);
  const record = await entityExists(target.type, target.id);
  if (!record) return json({ error: "That record no longer exists." }, 404);

  const user = auth.user;
  const people = await listMentionable();
  const mentioned = findMentions(body, people);
  const href = target.type === "project" ? `/projects/${target.id}?tab=discussion` : `/timelines?q=${encodeURIComponent(record.title.slice(0, 60))}`;
  const excerpt = body.length > 160 ? `${body.slice(0, 160)}…` : body;

  await sql.begin(async (tx) => {
    await tx`INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES (${target.type}, ${target.id}, ${user.userId}, ${body})`;
    for (const userId of mentioned) {
      await notify(
        { userId, actorId: user.userId, kind: "mention", title: `${user.name} mentioned you on ${record.title}`, body: excerpt, href },
        tx,
      );
    }
    // Also let the people responsible know, unless they were already mentioned.
    const watchers =
      target.type === "project"
        ? await tx<{ user_id: number }[]>`
            SELECT DISTINCT user_id FROM project_staff
             WHERE project_id = ${target.id}
               AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'America/Port_of_Spain')::date)`
        : await tx<{ user_id: number }[]>`SELECT owner_id AS user_id FROM staff_tasks WHERE id = ${target.id} AND owner_id IS NOT NULL`;
    for (const w of watchers) {
      if (mentioned.includes(w.user_id)) continue;
      await notify(
        { userId: w.user_id, actorId: user.userId, kind: "comment", title: `${user.name} commented on ${record.title}`, body: excerpt, href },
        tx,
      );
    }
    await recordAudit({
      user,
      action: "COMMENT",
      entity: target.type === "project" ? "project" : "staff_task",
      entityId: target.id,
      details: excerpt,
      tx,
    });
  });

  return json({ comments: await listComments(target.type, target.id) });
}

export async function DELETE(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const commentId = Number(url.searchParams.get("comment"));
  if (!Number.isSafeInteger(commentId) || commentId < 1) return json({ error: "Invalid comment." }, 400);
  const [row] = await sql<{ entity_type: CommentEntity; entity_id: number; author_id: number | null }[]>`
    SELECT entity_type, entity_id, author_id FROM comments WHERE id = ${commentId}`;
  if (!row) return json({ error: "That comment no longer exists." }, 404);
  const allowed = row.author_id === auth.user.userId || (await moderator(auth.user.role, row.entity_type));
  if (!allowed) return json({ error: "You can only remove your own comments." }, 403);
  await sql`DELETE FROM comments WHERE id = ${commentId}`;
  await recordAudit({
    user: auth.user,
    action: "DELETE",
    entity: row.entity_type === "project" ? "project" : "staff_task",
    entityId: row.entity_id,
    details: "Removed a comment",
  });
  return json({ comments: await listComments(row.entity_type, row.entity_id) });
}
