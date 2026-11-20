import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentUser, recordAudit, type CurrentUser } from "@/lib/auth";
import { hashBuffer, parseXlsxBuffer } from "@/lib/calendar-import";
import {
  getCalendarSyncConfig,
  getCalendarWebhookSecret,
  runSharePointAutoSync,
  upsertParsedEvents,
  type CalendarSyncConfigRow,
} from "@/lib/calendar-sync";
import { sql } from "@/lib/db";
import { can } from "@/lib/permissions";

export const maxDuration = 60;

const MAX_SYNC_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS });
}

function timingSafeMatches(candidate: string, secret: string): boolean {
  if (!candidate || !secret) return false;
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}

type AuthOutcome =
  | { ok: true; kind: "machine"; user: null }
  | { ok: true; kind: "session"; user: CurrentUser }
  | { ok: false; status: number; error: string };

async function authorizeSyncRequest(
  req: Request,
  requiredPermission: "calendar.view" | "calendar.manage",
): Promise<AuthOutcome> {
  const authHeader = req.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() || "";
  const syncKey = req.headers.get("x-sync-key")?.trim() || "";
  const hasTokenHeaders = Boolean(authHeader.trim() || syncKey);

  if (hasTokenHeaders) {
    const cronSecret = process.env.CRON_SECRET?.trim();
    const webhookSecret = getCalendarWebhookSecret();

    if (bearer && cronSecret && timingSafeMatches(bearer, cronSecret)) {
      return { ok: true, kind: "machine", user: null };
    }

    if (!webhookSecret) {
      return {
        ok: false,
        status: 503,
        error: "Calendar webhook secret is not configured.",
      };
    }

    if (
      (bearer && timingSafeMatches(bearer, webhookSecret)) ||
      (syncKey && timingSafeMatches(syncKey, webhookSecret))
    ) {
      return { ok: true, kind: "machine", user: null };
    }

    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (user.mustChangePassword) {
    return { ok: false, status: 403, error: "Password rotation required." };
  }
  if (!(await can(user.role, requiredPermission))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, kind: "session", user };
}

function serializeSyncStatus(config: CalendarSyncConfigRow) {
  return {
    autoSyncEnabled: config.auto_sync_enabled,
    syncIntervalMinutes: config.sync_interval_minutes,
    pruneDeleted: config.prune_deleted,
    lastStatus: config.last_status,
    lastSyncedAt: config.last_synced_at ? config.last_synced_at.toISOString() : null,
    lastAttemptedAt: config.last_attempted_at ? config.last_attempted_at.toISOString() : null,
    lastUpdatedAt: config.updated_at ? config.updated_at.toISOString() : null,
    lastMessage: config.last_message,
    lastAdded: config.last_added,
    lastUpdated: config.last_updated,
    lastRemoved: config.last_removed,
  };
}

function isZipMagic(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf.slice(0, 4));
  return (
    bytes.length === 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function safeSyncError(error: unknown): string {
  const msg = error instanceof Error ? error.message : "";
  if (
    msg.startsWith("Could not recognise workbook layout.") ||
    msg.startsWith("The CSV needs") ||
    msg.startsWith("Only .ics")
  ) {
    return msg;
  }
  console.error("[api/calendar/sync]", error);
  return "Calendar webhook sync failed.";
}

/**
 * GET /api/calendar/sync
 * - For browser session callers (`calendar.view`): strictly read-only sync status
 *   (no state mutations or outbound SharePoint pulls on GET).
 * - For authenticated Cron / machine header callers (`CRON_SECRET` / `CALENDAR_SYNC_SECRET`):
 *   runs scheduled `runSharePointAutoSync` check.
 */
export async function GET(req: Request) {
  const auth = await authorizeSyncRequest(req, "calendar.view");
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  if (auth.kind === "session") {
    const config = await getCalendarSyncConfig();
    return jsonResponse({
      ok: true,
      readOnly: true,
      ran: false,
      ...serializeSyncStatus(config),
    });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const result = await runSharePointAutoSync({ force, userId: null });
  if (result.ran && result.ok && !result.unchanged) {
    await recordAudit({
      user: null,
      action: "IMPORT",
      entity: "calendar_event",
      details: `Scheduled SharePoint sync: ${result.message}`,
    });
    revalidatePath("/calendar");
  }

  const status = result.ok ? 200 : result.needsAuth ? 424 : 502;
  return jsonResponse(
    {
      ok: result.ok,
      ran: result.ran,
      unchanged: result.unchanged,
      needsAuth: result.needsAuth,
      message: result.message,
      ...serializeSyncStatus(result.config),
    },
    status,
  );
}

/**
 * POST /api/calendar/sync
 * Webhook / Manager sync trigger:
 * 1. Raw binary .xlsx body (`Content-Type: application/octet-stream` or `.sheet`)
 * 2. JSON `{ "fileBase64": "..." }` or Power Automate `{ "$content": "..." }`
 * 3. `multipart/form-data` with `file` or `calendar_file`
 * 4. Empty body -> triggers a SharePoint pull (`?auto=1` respects interval, else forced)
 */
export async function POST(req: Request) {
  const auth = await authorizeSyncRequest(req, "calendar.manage");
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_SYNC_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Upload exceeds the 10 MB limit." }, 413);
    }
  }

  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    let buffer: ArrayBuffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("calendar_file") ?? fd.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return jsonResponse({ ok: false, error: "Attach a non-empty .xlsx file." }, 400);
      }
      if (file.size > MAX_SYNC_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Upload exceeds the 10 MB limit." }, 413);
      }
      buffer = await file.arrayBuffer();
    } else if (contentType.includes("application/json")) {
      const rawText = await req.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_SYNC_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Payload exceeds the 10 MB limit." }, 413);
      }
      if (!rawText.trim()) {
        return jsonResponse({ ok: false, error: "Empty JSON payload." }, 400);
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return jsonResponse({ ok: false, error: "Malformed JSON payload." }, 400);
      }
      const b64 =
        (typeof body?.fileBase64 === "string" && body.fileBase64) ||
        (typeof body?.$content === "string" && body.$content) ||
        (typeof (body?.body as Record<string, unknown> | undefined)?.$content === "string" &&
          ((body.body as Record<string, unknown>).$content as string));
      if (!b64) {
        return jsonResponse(
          { ok: false, error: "JSON payload must include fileBase64 or $content." },
          400,
        );
      }
      const nodeBuf = Buffer.from(b64, "base64");
      if (nodeBuf.byteLength === 0 || nodeBuf.byteLength > MAX_SYNC_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Decoded workbook size is invalid or exceeds 10 MB." }, 400);
      }
      buffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    } else {
      const raw = await req.arrayBuffer();
      if (raw.byteLength > MAX_SYNC_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Upload exceeds the 10 MB limit." }, 413);
      }
      if (raw.byteLength > 0) {
        buffer = raw;
      }
    }

    // Empty non-JSON/non-multipart POST triggers a SharePoint pull
    if (!buffer || buffer.byteLength === 0) {
      const url = new URL(req.url);
      const force = url.searchParams.get("auto") !== "1";
      const pullResult = await runSharePointAutoSync({
        force,
        userId: auth.user?.userId ?? null,
      });
      if (pullResult.ran && pullResult.ok && !pullResult.unchanged) {
        await recordAudit({
          user: auth.user,
          action: "IMPORT",
          entity: "calendar_event",
          details: `SharePoint sync (${auth.kind}): ${pullResult.message}`,
        });
        revalidatePath("/calendar");
      }
      const status = pullResult.ok ? 200 : pullResult.needsAuth ? 424 : 502;
      return jsonResponse(
        {
          ok: pullResult.ok,
          ran: pullResult.ran,
          unchanged: pullResult.unchanged,
          needsAuth: pullResult.needsAuth,
          message: pullResult.message,
          ...serializeSyncStatus(pullResult.config),
        },
        status,
      );
    }

    if (!isZipMagic(buffer)) {
      return jsonResponse(
        { ok: false, error: "Uploaded payload is not a valid .xlsx workbook." },
        400,
      );
    }

    const config = await getCalendarSyncConfig();
    const fileHash = hashBuffer(buffer);
    if (config.last_status === "SYNCED" && config.last_file_hash && config.last_file_hash === fileHash) {
      await sql`
        UPDATE calendar_sync_config
           SET last_attempted_at = now(),
               last_synced_at = now(),
               last_status = 'SYNCED',
               last_message = 'Webhook received (workbook unchanged).',
               last_added = 0,
               last_updated = 0,
               last_removed = 0,
               updated_at = now()
         WHERE id = 1`;
      return jsonResponse({
        ok: true,
        unchanged: true,
        message: "Workbook unchanged (SHA-256 matched).",
      });
    }

    const parsed = await parseXlsxBuffer(buffer);
    if (parsed.events.length === 0) {
      return jsonResponse(
        { ok: false, error: "No events found in the pushed workbook." },
        400,
      );
    }

    const { added, updated, removed } = await upsertParsedEvents(
      parsed.events,
      auth.user?.userId ?? null,
      true,
      {
        sourceTag: "WORKBOOK",
        pruneMissingWorkbookEvents: config.prune_deleted && parsed.format === "iica-grid",
        touchedMonths: parsed.format === "iica-grid" ? parsed.sheetMonths : undefined,
      },
    );

    const summary = `Webhook synced ${parsed.sheetsRead?.length ?? 1} sheets (${added} added, ${updated} updated, ${removed} removed)`;
    await sql`
      UPDATE calendar_sync_config
         SET last_attempted_at = now(),
             last_synced_at = now(),
             last_file_hash = ${fileHash},
             last_status = 'SYNCED',
             last_message = ${summary},
             last_added = ${added},
             last_updated = ${updated},
             last_removed = ${removed},
             updated_at = now()
       WHERE id = 1`;

    await recordAudit({
      user: auth.user,
      action: "IMPORT",
      entity: "calendar_event",
      details: summary,
    });

    revalidatePath("/calendar");
    return jsonResponse({
      ok: true,
      unchanged: false,
      added,
      updated,
      removed,
      sheetsRead: parsed.sheetsRead,
      message: summary,
    });
  } catch (error) {
    const message = safeSyncError(error);
    await sql`
      UPDATE calendar_sync_config
         SET last_attempted_at = now(),
             last_status = 'ERROR',
             last_message = ${message},
             updated_at = now()
       WHERE id = 1`.catch(() => {});
    return jsonResponse({ ok: false, error: message }, 400);
  }
}
