import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getPermissionMatrix } from "@/lib/permissions";
import { searchEverything } from "@/lib/search";

/** Backs the ⌘K search palette. Results are filtered by the caller's role. */
export async function GET(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const groups = await searchEverything(q, await getPermissionMatrix(), auth.user.role);
  return NextResponse.json(
    { groups },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
