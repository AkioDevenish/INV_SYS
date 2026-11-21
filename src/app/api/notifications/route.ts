import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** The signed-in person's notifications and unread count. */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listNotifications(auth.user.userId), { headers: HEADERS });
}

/** Marks one notification (`{ id }`) or all of them (`{}`) as read. */
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  // Same-origin only: a cross-site form can't post JSON with this content type without CORS.
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "Expected JSON." }, { status: 415, headers: HEADERS });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "number" && Number.isSafeInteger(body.id) && body.id > 0 ? body.id : undefined;
  await markNotificationsRead(auth.user.userId, id);
  return NextResponse.json(await listNotifications(auth.user.userId), { headers: HEADERS });
}
