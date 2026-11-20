"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import { hashPassword, passwordProblem } from "@/lib/password";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import {
  checkRateLimit,
  formatRetryAfter,
  getRequestClientInfo,
  recordAudit,
  recordRateLimitFailure,
  resetRateLimit,
} from "@/lib/auth";

export type SetupState = { error?: string; alreadySetUp?: boolean };

const SETUP_LOCK_ID = 918273;
const SETUP_IP_LIMIT = {
  maxRequests: 10,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

function matchesSetupToken(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function completeSetupAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  try {
    const { ip } = await getRequestClientInfo();
    if (ip !== "unknown") {
      const limit = checkRateLimit("setup:ip", ip, SETUP_IP_LIMIT);
      if (!limit.allowed) {
        return {
          error: `Too many setup attempts. Wait ${formatRetryAfter(limit.retryAfterSeconds)} and try again.`,
        };
      }
    }

    const expectedToken = process.env.SETUP_TOKEN?.trim() ?? "";
    if (expectedToken) {
      const providedToken = String(formData.get("setup_token") ?? "").trim();
      if (!providedToken || !matchesSetupToken(providedToken, expectedToken)) {
        if (ip !== "unknown") recordRateLimitFailure("setup:ip", ip, SETUP_IP_LIMIT);
        return { error: "Invalid setup token." };
      }
    }

    await ensureSchema();

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (!name) return { error: "Enter your name." };
    if (name.length > 120) return { error: "Name must be 120 characters or fewer." };
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: "Enter a valid email address." };
    }

    const problem = passwordProblem(password);
    if (problem) return { error: problem };
    if (password !== confirm) return { error: "The two passwords do not match." };

    const passwordHash = await hashPassword(password);

    const created = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${SETUP_LOCK_ID})`;

      const [row] = await tx<{ id: number; token_version: number }[]>`
        INSERT INTO users (name, email, password_hash, role, status, last_login_at)
        SELECT ${name}, ${email}, ${passwordHash}, 'ADMIN', 'ACTIVE', now()
        WHERE NOT EXISTS (SELECT 1 FROM users)
          AND NOT EXISTS (SELECT 1 FROM audit_logs)
        RETURNING id, token_version`;

      if (!row) return null;

      await recordAudit({
        user: {
          userId: row.id,
          name,
          email,
          role: "ADMIN",
          ver: row.token_version,
        },
        action: "SETUP",
        entity: "system",
        entityId: row.id,
        details: `First administrator created: ${name} <${email}>`,
        tx,
      });

      return row;
    });

    if (!created) {
      return {
        alreadySetUp: true,
        error: "This system has already been set up. Sign in with an existing account.",
      };
    }

    if (ip !== "unknown") resetRateLimit("setup:ip", ip);

    const session = {
      userId: created.id,
      name,
      email,
      role: "ADMIN" as const,
      ver: created.token_version,
    };

    const store = await cookies();
    store.set(SESSION_COOKIE, await signSession(session), sessionCookieOptions);
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      return { error: "An account already uses that email address." };
    }
    console.error("Setup failed:", error);
    return {
      error: "Could not complete setup. Check the database connection and try again.",
    };
  }

  const matrix = await getPermissionMatrix();
  redirect(defaultHomeForRole(matrix, "ADMIN"));
}
