import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/auth";
import { sendWeeklyReminders } from "@/lib/reminders";

export const maxDuration = 60;

function matches(candidate: string, secret: string): boolean {
  if (!candidate || !secret) return false;
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Vercel Cron calls this every Monday (see vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Anything else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || !matches(bearer, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const run = await sendWeeklyReminders();
  if (!run.notConfigured) {
    await recordAudit({
      user: null,
      action: "REMINDERS",
      entity: "system",
      details: `Weekly reminders: ${run.sent} sent, ${run.nothingDue} with nothing due, ${run.skippedRecent} already sent this week, ${run.failed.length} failed`,
    });
  }
  return NextResponse.json(run, { status: run.notConfigured ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
