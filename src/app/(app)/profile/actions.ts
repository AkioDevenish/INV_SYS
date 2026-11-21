"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import {
  assertSignedIn,
  checkRateLimit,
  formatRetryAfter,
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
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

export type ProfileState = { error?: string; message?: string };

const PASSWORD_CHANGE_LIMIT = {
  maxRequests: 5,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

function safeProfileError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith("You ")) {
    return error.message;
  }
  console.error(fallback, error);
  return fallback;
}

export async function updateProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  try {
    const user = await assertSignedIn();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Enter your name." };
    if (name.length > 120) return { error: "Name must be 120 characters or fewer." };

    await sql.begin(async (tx) => {
      await tx`UPDATE users SET name = ${name} WHERE id = ${user.userId}`;
      await recordAudit({
        user,
        action: "UPDATE",
        entity: "profile",
        entityId: user.userId,
        details: name,
        tx,
      });
    });

    // Refresh the cookie so the sidebar shows the new name straight away.
    const store = await cookies();
    store.set(
      SESSION_COOKIE,
      await signSession({
        userId: user.userId,
        name,
        email: user.email,
        role: user.role,
        ver: user.ver,
      }),
      sessionCookieOptions,
    );

    revalidatePath("/", "layout");
    return { message: "Your details were saved." };
  } catch (error) {
    return { error: safeProfileError(error, "Could not save your details. Please try again.") };
  }
}

export async function changePasswordAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  try {
    const user = await assertSignedIn();
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

    const current = String(formData.get("current_password") ?? "");
    const next = String(formData.get("new_password") ?? "");
    const confirm = String(formData.get("confirm_password") ?? "");

    if (!current || current.length > MAX_PASSWORD_LENGTH) {
      return { error: "Your current password is not correct." };
    }

    const problem = passwordProblem(next);
    if (problem) return { error: problem };
    if (next !== confirm) return { error: "The new passwords do not match." };

    const nextHash = await hashPassword(next);

    const outcome = await sql.begin(async (tx) => {
      const [row] = await tx<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${user.userId} FOR UPDATE`;
      if (!row) return { error: "Your account could not be found." } as const;

      if (!(await verifyPassword(current, row.password_hash))) {
        return { error: "Your current password is not correct.", badCurrent: true } as const;
      }
      if (await verifyPassword(next, row.password_hash)) {
        return { error: "Choose a password different from your current one." } as const;
      }

      const [saved] = await tx<{ token_version: number }[]>`
        UPDATE users
        SET password_hash = ${nextHash},
            token_version = token_version + 1
        WHERE id = ${user.userId}
        RETURNING token_version`;
      if (!saved) return { error: "Your account could not be found." } as const;

      await recordAudit({
        user,
        action: "CHANGE_PASSWORD",
        entity: "profile",
        entityId: user.userId,
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

    return { message: "Your password was changed." };
  } catch (error) {
    return { error: safeProfileError(error, "Could not change your password. Please try again.") };
  }
}
