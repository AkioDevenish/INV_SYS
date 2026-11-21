"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import {
  assertPermission,
  checkRateLimit,
  formatRetryAfter,
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
import { getPermissionMatrix } from "@/lib/permissions";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { isRole, type PermissionMatrix, type Role } from "@/lib/roles";

export type UserState = { error?: string; ok?: boolean; message?: string };

const SELF_PASSWORD_LIMIT = {
  maxRequests: 5,
  windowMs: 15 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 15 * 60_000,
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

function roleHasExtraPermissions(
  matrix: PermissionMatrix,
  actorRole: Role,
  targetRole: Role,
): boolean {
  const actorPerms = new Set(matrix[actorRole] ?? []);
  return (matrix[targetRole] ?? []).some((perm) => !actorPerms.has(perm));
}

function safeUserError(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.message.startsWith("You ") || error.message.startsWith("Your role"))) {
    return error.message;
  }
  const pgCode = (error as { code?: string })?.code;
  if (pgCode === "23505") {
    return "An account already uses that email address.";
  }
  if (pgCode === "23503") {
    return "This account is referenced by active project staff records and cannot be deleted. Disable the account instead to preserve project history.";
  }
  console.error(fallback, error);
  return fallback;
}

function revalidateUserRoutes() {
  revalidatePath("/users");
  revalidatePath("/access");
  revalidatePath("/audit");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath("/timelines");
  revalidatePath("/calendar");
}

export async function createUserAction(_prev: UserState, formData: FormData): Promise<UserState> {
  try {
    const admin = await assertPermission("users.manage");

    const name = text(formData, "name");
    const email = text(formData, "email").toLowerCase();
    const role = text(formData, "role");
    const password = String(formData.get("password") ?? "");

    if (!name) return { error: "Enter the person's name." };
    if (name.length > 120) return { error: "Name must be 120 characters or fewer." };
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: "Enter a valid email address." };
    }
    if (!isRole(role)) return { error: "Choose a role." };

    if (admin.role !== "ADMIN") {
      if (role === "ADMIN") {
        return { error: "Your role cannot create an Administrator account." };
      }
      const matrix = await getPermissionMatrix();
      if (roleHasExtraPermissions(matrix, admin.role, role)) {
        return { error: "Your role cannot assign an access level with permissions you do not hold." };
      }
    }

    const problem = passwordProblem(password);
    if (problem) return { error: problem };

    const passwordHash = await hashPassword(password);

    await sql.begin(async (tx) => {
      const [created] = await tx<{ id: number }[]>`
        INSERT INTO users (name, email, password_hash, role, status, must_change_password)
        VALUES (${name}, ${email}, ${passwordHash}, ${role}, 'ACTIVE', true)
        RETURNING id`;

      await recordAudit({
        user: admin,
        action: "CREATE",
        entity: "user",
        entityId: created.id,
        details: `${name} <${email}> as ${role}`,
        tx,
      });
    });

    revalidateUserRoutes();
    return { ok: true, message: `${name} can now sign in.` };
  } catch (error) {
    return { error: safeUserError(error, "Could not create the account.") };
  }
}

export async function updateUserAction(_prev: UserState, formData: FormData): Promise<UserState> {
  try {
    const admin = await assertPermission("users.manage");

    const id = parsePositiveInt(formData.get("id"));
    const name = text(formData, "name");
    const email = text(formData, "email").toLowerCase();
    const role = text(formData, "role");
    const rawStatus = text(formData, "status");
    const password = String(formData.get("password") ?? "");
    const currentPassword = String(formData.get("current_password") ?? "");

    if (!id) return { error: "Missing or invalid account reference." };
    if (!name) return { error: "Enter the person's name." };
    if (name.length > 120) return { error: "Name must be 120 characters or fewer." };
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: "Enter a valid email address." };
    }
    if (!isRole(role)) return { error: "Choose a role." };
    if (rawStatus !== "ACTIVE" && rawStatus !== "DISABLED") {
      return { error: "Choose an account status." };
    }
    const status = rawStatus;

    const isSelf = admin.userId === id;

    if (isSelf && password) {
      const limit = checkRateLimit("password:user", String(admin.userId), SELF_PASSWORD_LIMIT);
      if (!limit.allowed) {
        return {
          error: `Too many password attempts. Wait ${formatRetryAfter(limit.retryAfterSeconds)} and try again.`,
        };
      }
      if (!currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) {
        return { error: "Enter your current password to change your own password." };
      }
    }

    let passwordHash: string | null = null;
    if (password) {
      const problem = passwordProblem(password);
      if (problem) return { error: problem };
      passwordHash = await hashPassword(password);
    }

    const matrix = admin.role !== "ADMIN" ? await getPermissionMatrix() : null;

    const result = await sql.begin(async (tx) => {
      const activeAdmins = await tx<{ id: number }[]>`
        SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`;

      const [target] = await tx<
        { id: number; email: string; role: Role; status: string; password_hash: string }[]
      >`SELECT id, email, role, status, password_hash FROM users WHERE id = ${id} FOR UPDATE`;
      if (!target) return { error: "That account no longer exists." } as const;

      if (admin.role !== "ADMIN") {
        if (target.role === "ADMIN" || role === "ADMIN") {
          return { error: "Your role cannot edit or assign Administrator accounts." } as const;
        }
        if (matrix && roleHasExtraPermissions(matrix, admin.role, target.role)) {
          return { error: "Your role cannot edit an account with permissions you do not hold." } as const;
        }
        if (matrix && role !== target.role && roleHasExtraPermissions(matrix, admin.role, role)) {
          return { error: "Your role cannot assign an access level with permissions you do not hold." } as const;
        }
      }

      if (isSelf && passwordHash) {
        if (!(await verifyPassword(currentPassword, target.password_hash))) {
          return { error: "Your current password is not correct.", badCurrent: true } as const;
        }
      }

      const wasActiveAdmin = target.role === "ADMIN" && target.status === "ACTIVE";
      const staysActiveAdmin = role === "ADMIN" && status === "ACTIVE";
      if (wasActiveAdmin && !staysActiveAdmin && activeAdmins.length <= 1) {
        return {
          error: isSelf
            ? "You are the only active administrator - appoint another one before changing your own access."
            : "This is the last active administrator - appoint another one first.",
        } as const;
      }

      const emailChanged = email !== target.email.toLowerCase();
      const bumpVersion =
        Boolean(passwordHash) || status === "DISABLED" || role !== target.role || emailChanged;

      const [updated] = passwordHash
        ? await tx<{ token_version: number }[]>`
            UPDATE users
            SET name = ${name},
                email = ${email},
                role = ${role},
                status = ${status},
                password_hash = ${passwordHash},
                must_change_password = ${isSelf ? false : true},
                token_version = token_version + 1
            WHERE id = ${id}
            RETURNING token_version`
        : await tx<{ token_version: number }[]>`
            UPDATE users
            SET name = ${name},
                email = ${email},
                role = ${role},
                status = ${status},
                token_version = ${bumpVersion ? sql`token_version + 1` : sql`token_version`}
            WHERE id = ${id}
            RETURNING token_version`;

      if (passwordHash) {
        await recordAudit({
          user: admin,
          action: "RESET_PASSWORD",
          entity: "user",
          entityId: id,
          details: isSelf ? `Self password reset <${email}>` : `${name} <${email}>`,
          tx,
        });
      }

      await recordAudit({
        user: admin,
        action: "UPDATE",
        entity: "user",
        entityId: id,
        details: `${name} <${email}> - ${role}, ${status}`,
        tx,
      });

      return { ok: true, tokenVersion: updated.token_version } as const;
    });

    if ("error" in result) {
      if ("badCurrent" in result && result.badCurrent) {
        recordRateLimitFailure("password:user", String(admin.userId), SELF_PASSWORD_LIMIT);
      }
      return { error: result.error };
    }

    if (isSelf && passwordHash) {
      resetRateLimit("password:user", String(admin.userId));
    }

    if (isSelf && status === "ACTIVE") {
      const store = await cookies();
      store.set(
        SESSION_COOKIE,
        await signSession({
          userId: id,
          name,
          email,
          role,
          ver: result.tokenVersion,
        }),
        sessionCookieOptions,
      );
    }

    revalidateUserRoutes();
    return { ok: true, message: `Updated ${name}.` };
  } catch (error) {
    return { error: safeUserError(error, "Could not update the account.") };
  }
}

export async function deleteUserAction(_prev: UserState, formData: FormData): Promise<UserState> {
  try {
    const admin = await assertPermission("users.manage");
    const id = parsePositiveInt(formData.get("id"));
    if (!id) return { error: "Missing or invalid account reference." };
    if (id === admin.userId) return { error: "You cannot delete your own account." };

    const matrix = admin.role !== "ADMIN" ? await getPermissionMatrix() : null;

    const outcome = await sql.begin(async (tx) => {
      const activeAdmins = await tx<{ id: number }[]>`
        SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`;

      const [target] = await tx<{ name: string; email: string; role: Role; status: string }[]>`
        SELECT name, email, role, status FROM users WHERE id = ${id} FOR UPDATE`;
      if (!target) return { missing: true } as const;

      if (admin.role !== "ADMIN") {
        if (target.role === "ADMIN") {
          return { error: "Your role cannot delete an Administrator account." } as const;
        }
        if (matrix && roleHasExtraPermissions(matrix, admin.role, target.role)) {
          return { error: "Your role cannot delete an account with permissions you do not hold." } as const;
        }
      }

      if (target.role === "ADMIN" && target.status === "ACTIVE" && activeAdmins.length <= 1) {
        return {
          error: "This is the last active administrator - promote someone else first.",
        } as const;
      }

      // Movements keep their history; the schema nulls the user reference.
      await tx`DELETE FROM users WHERE id = ${id}`;

      await recordAudit({
        user: admin,
        action: "DELETE",
        entity: "user",
        entityId: id,
        details: `${target.name} <${target.email}>`,
        tx,
      });

      return { name: target.name } as const;
    });

    if ("error" in outcome) return { error: outcome.error };
    if ("missing" in outcome) return { ok: true };

    revalidateUserRoutes();
    return { ok: true, message: `${outcome.name} no longer has access.` };
  } catch (error) {
    return { error: safeUserError(error, "Could not delete the account.") };
  }
}
