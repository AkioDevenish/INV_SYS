"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import {
  MAX_PASSWORD_LENGTH,
  hashPassword,
  needsPasswordRehash,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/password";
import { SESSION_COOKIE, signSession, sessionCookieOptions } from "@/lib/session";
import {
  checkRateLimit,
  formatRetryAfter,
  getCurrentUser,
  getRequestClientInfo,
  recordAudit,
  recordRateLimitFailure,
  resetRateLimit,
  sanitizeNextPath,
} from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import type { Role } from "@/lib/roles";

export type LoginState = { error?: string };

const LOGIN_EMAIL_LIMIT = {
  maxRequests: 5,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

const LOGIN_IP_LIMIT = {
  maxRequests: 20,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

const DB_FAILED_SIGNIN_THRESHOLD = 8;

async function logFailedSignIn(email: string, reason: string, ip: string, userAgent: string) {
  try {
    await recordAudit({
      user: null,
      action: "SIGN_IN_FAILED",
      entity: "session",
      entityId: email.slice(0, 254),
      details: `${reason} | IP: ${ip} | UA: ${userAgent}`,
    });
  } catch (error) {
    console.error("Failed to record SIGN_IN_FAILED audit entry:", error);
  }
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  const invalid = { error: "Those credentials do not match an account." };
  if (email.length > 254 || password.length > MAX_PASSWORD_LENGTH) {
    return invalid;
  }

  const { ip, userAgent } = await getRequestClientInfo();

  if (ip !== "unknown") {
    const ipCheck = checkRateLimit("login:ip", ip, LOGIN_IP_LIMIT);
    if (!ipCheck.allowed) {
      return {
        error: `Too many sign-in attempts. Wait ${formatRetryAfter(ipCheck.retryAfterSeconds)} and try again.`,
      };
    }
  }

  const emailCheck = checkRateLimit("login:email", email, LOGIN_EMAIL_LIMIT);
  if (!emailCheck.allowed) {
    return {
      error: `Too many failed sign-in attempts for this account. Wait ${formatRetryAfter(emailCheck.retryAfterSeconds)} and try again.`,
    };
  }

  // Distributed serverless backstop using recent SIGN_IN_FAILED rows in audit_logs.
  try {
    const [recentFailures] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM audit_logs
      WHERE action = 'SIGN_IN_FAILED'
        AND entity = 'session'
        AND entity_id = ${email}
        AND created_at > now() - interval '15 minutes'`;
    if ((recentFailures?.n ?? 0) >= DB_FAILED_SIGNIN_THRESHOLD) {
      return {
        error: "Too many failed sign-in attempts for this account. Wait a few minutes and try again.",
      };
    }
  } catch {
    // Do not block sign-in if the audit count check fails transiently.
  }

  const [user] = await sql<
    {
      id: number;
      name: string;
      email: string;
      password_hash: string;
      role: Role;
      status: string;
      must_change_password: boolean;
      token_version: number;
    }[]
  >`SELECT id, name, email, password_hash, role, status, must_change_password, token_version
    FROM users
    WHERE lower(email) = ${email}
    ORDER BY id ASC
    LIMIT 1`;

  // Same work and error message either way so the form never confirms which emails exist.
  if (!user) {
    await verifyDummyPassword(password);
    if (ip !== "unknown") recordRateLimitFailure("login:ip", ip, LOGIN_IP_LIMIT);
    recordRateLimitFailure("login:email", email, LOGIN_EMAIL_LIMIT);
    await logFailedSignIn(email, "Unknown account", ip, userAgent);
    return invalid;
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    if (ip !== "unknown") recordRateLimitFailure("login:ip", ip, LOGIN_IP_LIMIT);
    const lock = recordRateLimitFailure("login:email", email, LOGIN_EMAIL_LIMIT);
    await logFailedSignIn(email, `Invalid password (user #${user.id})`, ip, userAgent);
    if (!lock.allowed) {
      return {
        error: `Too many failed sign-in attempts. Wait ${formatRetryAfter(lock.retryAfterSeconds)} and try again.`,
      };
    }
    return invalid;
  }

  if (user.status !== "ACTIVE") {
    if (ip !== "unknown") recordRateLimitFailure("login:ip", ip, LOGIN_IP_LIMIT);
    recordRateLimitFailure("login:email", email, LOGIN_EMAIL_LIMIT);
    await logFailedSignIn(email, `Disabled account (user #${user.id})`, ip, userAgent);
    return { error: "This account has been disabled. Contact an administrator." };
  }

  resetRateLimit("login:email", email);

  // Transparently upgrade legacy 3-part or lower-cost scrypt hashes on sign-in.
  if (needsPasswordRehash(user.password_hash)) {
    const upgradedHash = await hashPassword(password);
    await sql`
      UPDATE users
      SET password_hash = ${upgradedHash}, last_login_at = now()
      WHERE id = ${user.id}`;
  } else {
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  }

  const session = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ver: user.token_version,
  };

  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(session), sessionCookieOptions);

  await recordAudit({
    user: session,
    action: "SIGN_IN",
    entity: "session",
    entityId: user.id,
    details: ip !== "unknown" ? `IP: ${ip}` : null,
  });

  if (user.must_change_password) {
    redirect("/change-password");
  }

  if (nextPath) {
    redirect(nextPath);
  }

  const matrix = await getPermissionMatrix();
  redirect(defaultHomeForRole(matrix, user.role));
}

export async function logoutAction() {
  try {
    const user = await getCurrentUser();
    if (user) {
      // Bump token_version server-side so any copied/exfiltrated session JWT is revoked immediately.
      await sql.begin(async (tx) => {
        await tx`UPDATE users SET token_version = token_version + 1 WHERE id = ${user.userId}`;
        await recordAudit({
          user,
          action: "SIGN_OUT",
          entity: "session",
          entityId: user.userId,
          tx,
        });
      });
    }
  } catch {
    // Signing out must still clear the cookie even if DB revocation or audit logging fails.
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
