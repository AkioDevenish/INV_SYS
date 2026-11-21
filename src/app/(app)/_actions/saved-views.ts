"use server";

import { sql } from "@/lib/db";
import { assertSignedIn } from "@/lib/auth";
import { ensureSchema } from "@/lib/setup";

export type SavedView = { id: number; name: string; query: string };

const PAGES = ["timelines", "projects", "vendors"] as const;
type Page = (typeof PAGES)[number];
const isPage = (p: string): p is Page => (PAGES as readonly string[]).includes(p);

/** Keeps only the filter part of a query string; drops paging. */
function cleanQuery(raw: string): string {
  const params = new URLSearchParams(raw.replace(/^\?/, ""));
  params.delete("page");
  return params.toString().slice(0, 1000);
}

export async function listSavedViewsAction(page: string): Promise<SavedView[]> {
  if (!isPage(page)) return [];
  await ensureSchema();
  const user = await assertSignedIn();
  return sql<SavedView[]>`
    SELECT id, name, query FROM saved_views
     WHERE user_id = ${user.userId} AND page = ${page}
     ORDER BY lower(name)`;
}

export async function saveViewAction(
  page: string,
  name: string,
  query: string,
): Promise<{ ok?: boolean; error?: string; views?: SavedView[] }> {
  if (!isPage(page)) return { error: "Unknown page." };
  const label = name.trim().slice(0, 60);
  if (!label) return { error: "Give the view a name." };
  const q = cleanQuery(query);
  if (!q) return { error: "Set some filters first, then save them as a view." };
  await ensureSchema();
  const user = await assertSignedIn();
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM saved_views WHERE user_id = ${user.userId} AND page = ${page}`;
  if (n >= 20) return { error: "You can keep up to 20 views per page. Remove one first." };
  await sql`
    INSERT INTO saved_views (user_id, page, name, query) VALUES (${user.userId}, ${page}, ${label}, ${q})
    ON CONFLICT (user_id, page, lower(name)) DO UPDATE SET query = EXCLUDED.query`;
  return { ok: true, views: await listSavedViewsAction(page) };
}

export async function deleteViewAction(page: string, id: number): Promise<SavedView[]> {
  const user = await assertSignedIn();
  await sql`DELETE FROM saved_views WHERE id = ${id} AND user_id = ${user.userId}`;
  return listSavedViewsAction(page);
}
