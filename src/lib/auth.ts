import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type postgres from "postgres";
import { sql } from "./db";
import { SESSION_COOKIE, readSession, type SessionPayload } from "./session";
import { isRole, type Permission } from "./roles";
import { can } from "./permissions";

export type CurrentUser = SessionPayload & { mustChangePassword?: boolean };
export type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
  /** Progressive lockout base duration when the limit is exceeded. */
  lockoutBaseMs?: number;
  maxLockoutMs?: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type RateBucketEntry = {
  timestamps: number[];
  lockedUntil: number;
  strikes: number;
  lastSeen: number;
};

const MAX_RATE_BUCKETS = 5_000;
const globalForRateLimit = globalThis as unknown as {
  __iicaRateBuckets?: Map<string, RateBucketEntry>;
};

function rateStore(): Map<string, RateBucketEntry> {
  globalForRateLimit.__iicaRateBuckets ??= new Map();
  return globalForRateLimit.__iicaRateBuckets;
}

function pruneStoreIfNeeded(store: Map<string, RateBucketEntry>, now: number) {
  if (store.size < MAX_RATE_BUCKETS) return;
  for (const [k, entry] of store) {
    if (entry.lockedUntil <= now && now - entry.lastSeen > 30 * 60_000) {
      store.delete(k);
    }
    if (store.size < MAX_RATE_BUCKETS * 0.8) break;
  }
  while (store.size >= MAX_RATE_BUCKETS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function getBucket(bucket: string, key: string, windowMs: number, now: number): RateBucketEntry {
  const store = rateStore();
  const fullKey = `${bucket}:${key}`;
  const existing = store.get(fullKey);
  if (!existing) {
    pruneStoreIfNeeded(store, now);
    const fresh: RateBucketEntry = { timestamps: [], lockedUntil: 0, strikes: 0, lastSeen: now };
    store.set(fullKey, fresh);
    return fresh;
  }
  const cutoff = now - windowMs;
  if (existing.timestamps.length > 0) {
    existing.timestamps = existing.timestamps.filter((t) => t > cutoff);
  }
  if (existing.lockedUntil <= now && existing.timestamps.length === 0 && now - existing.lastSeen > windowMs * 2) {
    existing.strikes = 0;
  }
  existing.lastSeen = now;
  return existing;
}

/** Checks if a key is currently locked out or at its sliding-window limit without consuming a token. */
export function checkRateLimit(
  bucket: string,
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const entry = getBucket(bucket, key, options.windowMs, now);
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)) };
  }
  if (entry.timestamps.length >= options.maxRequests) {
    const oldest = entry.timestamps[0] ?? now;
    const retryMs = Math.max(1000, oldest + options.windowMs - now);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  return { allowed: true };
}

/** Consumes one request token in a sliding window and returns whether the request is allowed. */
export function consumeRateLimit(
  bucket: string,
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const entry = getBucket(bucket, key, options.windowMs, now);
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)) };
  }
  if (entry.timestamps.length >= options.maxRequests) {
    if (options.lockoutBaseMs) {
      entry.strikes = Math.min(entry.strikes + 1, 8);
      const lockoutMs = Math.min(
        options.maxLockoutMs ?? 15 * 60_000,
        options.lockoutBaseMs * 2 ** (entry.strikes - 1),
      );
      entry.lockedUntil = now + lockoutMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(lockoutMs / 1000)) };
    }
    const oldest = entry.timestamps[0] ?? now;
    const retryMs = Math.max(1000, oldest + options.windowMs - now);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  entry.timestamps.push(now);
  return { allowed: true };
}

/** Records a failed auth attempt and triggers progressive lockout once threshold is reached. */
export function recordRateLimitFailure(
  bucket: string,
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const entry = getBucket(bucket, key, options.windowMs, now);
  entry.timestamps.push(now);
  if (entry.timestamps.length >= options.maxRequests) {
    entry.strikes = Math.min(entry.strikes + 1, 8);
    const base = options.lockoutBaseMs ?? 60_000;
    const maxLockout = options.maxLockoutMs ?? 15 * 60_000;
    const lockoutMs = Math.min(maxLockout, base * 2 ** (entry.strikes - 1));
    entry.lockedUntil = now + lockoutMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(lockoutMs / 1000)) };
  }
  return { allowed: true };
}

export function resetRateLimit(bucket: string, key: string): void {
  rateStore().delete(`${bucket}:${key}`);
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const mins = Math.ceil(seconds / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** Extracts client IP and truncated User-Agent from Next.js request headers or a Request object. */
export async function getRequestClientInfo(
  request?: Request,
): Promise<{ ip: string; userAgent: string }> {
  try {
    const hdrs = request ? request.headers : await headers();
    const forwarded = hdrs.get("x-forwarded-for");
    const realIp = hdrs.get("x-real-ip") ?? hdrs.get("cf-connecting-ip");
    const firstForwarded = forwarded?.split(",")[0]?.trim();
    const ip = (firstForwarded || realIp || "unknown").slice(0, 64);
    const userAgent = (hdrs.get("user-agent") ?? "unknown").replace(/[\r\n\t]+/g, " ").slice(0, 160);
    return { ip, userAgent };
  } catch {
    return { ip: "unknown", userAgent: "unknown" };
  }
}

const AUTH_BLOCKED_PREFIXES = ["/login", "/setup", "/change-password", "/api"];

/** Ensures any post-login `?next=` redirect stays a safe internal App Router path. */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return null;
  }
  if (/[\x00-\x1f\x7f\\]/.test(trimmed)) return null;
  const pathOnly = trimmed.split(/[?#]/)[0] ?? "";
  if (
    AUTH_BLOCKED_PREFIXES.some(
      (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }
  return trimmed;
}

/** Returns the signed-in user, or null. Re-checks status, role and token_version per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const [row] = await sql<
    {
      id: number;
      name: string;
      email: string;
      role: string;
      status: string;
      must_change_password: boolean;
      token_version: number;
    }[]
  >`SELECT id, name, email, role, status, must_change_password, token_version
    FROM users WHERE id = ${session.userId}`;

  if (!row || row.status !== "ACTIVE") return null;
  if (!isRole(row.role) || row.token_version !== session.ver) return null;

  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    ver: row.token_version,
    mustChangePassword: row.must_change_password,
  };
});

export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const safeNext = sanitizeNextPath(nextPath);
    redirect(safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login");
  }
  // A temporary password gets you exactly one destination.
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

/** Use in pages: sends users without the permission to the access-denied screen. */
export async function requirePermission(
  permission: Permission,
  nextPath?: string,
): Promise<CurrentUser> {
  const user = await requireUser(nextPath);
  if (!(await can(user.role, permission))) redirect(`/denied?permission=${permission}`);
  return user;
}

/** Use in server actions without permission gate (e.g. dashboard layout). */
export async function assertSignedIn(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are not signed in.");
  if (user.mustChangePassword) {
    throw new Error("You must choose a new password before continuing.");
  }
  return user;
}

/** Use in server actions: throws instead of redirecting so the caller can show an error. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await assertSignedIn();
  if (!(await can(user.role, permission))) {
    throw new Error("Your role does not allow this action.");
  }
  return user;
}

export type ApiAuthResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse };

function apiAuthError(status: 401 | 403, error: string): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/** Use in API routes: verifies sign-in and password rotation policy. */
export async function requireApiUser(): Promise<ApiAuthResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: apiAuthError(401, "Authentication required.") };
  if (user.mustChangePassword) {
    return { ok: false, response: apiAuthError(403, "Password change required.") };
  }
  return { ok: true, user };
}

/** Use in API routes: enforces sign-in, password rotation policy, and RBAC permission. */
export async function requireApiPermission(permission: Permission): Promise<ApiAuthResult> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth;
  if (!(await can(auth.user.role, permission))) {
    return { ok: false, response: apiAuthError(403, "Forbidden.") };
  }
  return auth;
}

export async function recordAudit(
  input: {
    user: CurrentUser | null;
    action: string;
    entity: string;
    entityId?: string | number | null;
    details?: string | null;
    tx?: SqlExecutor;
  },
  tx?: SqlExecutor,
): Promise<void> {
  const db = tx ?? input.tx ?? sql;
  await db`
    INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
    VALUES (
      ${input.user?.userId ?? null},
      ${input.user ? `${input.user.name} (${input.user.email})` : "system"},
      ${input.action},
      ${input.entity},
      ${input.entityId == null ? null : String(input.entityId)},
      ${input.details ?? null}
    )`;
}
