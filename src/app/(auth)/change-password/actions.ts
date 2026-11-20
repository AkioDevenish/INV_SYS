"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import {
  checkRateLimit,
  formatRetryAfter,
  getCurrentUser,
  getRequestClientInfo,
  recordAudit,
  recordRateLimitFailure,
  resetRateLimit,
} from "@/lib/auth";
import {
  MAX_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

export type ChangeState = { error?: string };

const PASSWORD_CHANGE_LIMIT = {
  maxRequests: 5,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

/**
 * Used only for the forced change after an administrator issues a temporary
 * password. It clears `must_change_password`, which is what lets the person
 * out of this screen.
 */
export async function forceChangePasswordAction(
  _prev: ChangeState,
  formData: FormData,
): Promise<ChangeState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) {
    const matrix = await getPermissionMatrix();
    redirect(defaultHomeForRole(matrix, user.role));
  }

  const { ip } = await getRequestClientInfo();
  const userCheck = checkRateLimit("password:user", String(user.userId), PASSWORD_CHANGE_LIMIT);
  if (!userCheck.allowed) {
    return {
      error: `Too many password attempts. Wait ${formatRetryAfter(userCheck.retryAfterSeconds)} and try again.`,
    };
  }
  if (ip !== "unknown") {
    const ipCheck = checkRateLimit("password:ip", ip, {
      ...PASSWORD_CHANGE_LIMIT,
      maxRequests: PASSWORD_CHANGE_LIMIT.maxRequests * 3,
    });
    if (!ipCheck.allowed) {
      return {
        error: `Too many password attempts. Wait ${formatRetryAfter(ipCheck.retryAfterSeconds)} and try again.`,
      };
    }
  }

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || current.length > MAX_PASSWORD_LENGTH) {
    return { error: "That temporary password is not right." };
  }

  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "The two new passwords do not match." };

  try {
    const nextHash = await hashPassword(password);

    const outcome = await sql.begin(async (tx) => {
      const [row] = await tx<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${user.userId} FOR UPDATE`;
      if (!row) return { error: "Your account could not be found." } as const;

      if (!(await verifyPassword(current, row.password_hash))) {
        return { error: "That temporary password is not right.", badCurrent: true } as const;
      }

      if (await verifyPassword(password, row.password_hash)) {
        return { error: "Choose a password different from the temporary one." } as const;
      }

      const [saved] = await tx<{ token_version: number }[]>`
        UPDATE users
        SET password_hash = ${nextHash},
            must_change_password = false,
            token_version = token_version + 1
        WHERE id = ${user.userId}
        RETURNING token_version`;
      if (!saved) return { error: "Your account could not be found." } as const;

      await recordAudit({
        user,
        action: "CHANGE_PASSWORD",
        entity: "user",
        entityId: user.userId,
        details: "Set own password after first sign-in",
        tx,
      });

      return { tokenVersion: saved.token_version } as const;
    });

    if ("error" in outcome) {
      if (outcome.badCurrent) {
        recordRateLimitFailure("password:user", String(user.userId), PASSWORD_CHANGE_LIMIT);
        if (ip !== "unknown") {
          recordRateLimitFailure("password:ip", ip, {
            ...PASSWORD_CHANGE_LIMIT,
            maxRequests: PASSWORD_CHANGE_LIMIT.maxRequests * 3,
          });
        }
      }
      return { error: outcome.error };
    }

    resetRateLimit("password:user", String(user.userId));

    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      await signSession({
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        ver: outcome.tokenVersion,
      }),
      sessionCookieOptions,
    );
  } catch (error) {
    console.error("Failed to change temporary password:", error);
    return { error: "Could not save your new password. Please try again." };
  }

  const matrix = await getPermissionMatrix();
  redirect(defaultHomeForRole(matrix, user.role));
}
