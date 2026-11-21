"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth";
import { resetPermissionMatrix, savePermissionMatrix } from "@/lib/permissions";
import {
  LOCKED,
  isPermission,
  isRole,
  type PermissionMatrix,
} from "@/lib/roles";

export type MatrixState = { error?: string; ok?: boolean; saved?: string };

function safePermissionError(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.message.startsWith("You ") || error.message.startsWith("Your role"))) {
    return error.message;
  }
  console.error(fallback, error);
  return fallback;
}

export async function savePermissionsAction(
  _prev: MatrixState,
  formData: FormData,
): Promise<MatrixState> {
  try {
    const user = await assertPermission("users.manage");

    // Checkboxes post as "ROLE:permission"; unchecked boxes post nothing.
    const next: PermissionMatrix = { ADMIN: [], MANAGER: [], STAFF: [], VIEWER: [] };
    for (const raw of formData.getAll("cell")) {
      const [role, permission] = String(raw).split(":");
      if (isRole(role) && isPermission(permission) && !next[role].includes(permission)) {
        next[role].push(permission);
      }
    }
    if (!next[LOCKED.role].includes(LOCKED.permission)) next[LOCKED.role].push(LOCKED.permission);

    // Diff, privilege escalation checks, write, and audit log all run atomically under the advisory lock.
    const { changes } = await savePermissionMatrix(next, user);
    if (changes.length === 0) return { ok: true, saved: "No changes to save." };

    // Permissions decide what the sidebar shows and what every page allows, so
    // the whole tree has to be reconsidered, not just this page.
    revalidatePath("/", "layout");
    revalidatePath("/access");
    return { ok: true, saved: `Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return { error: safePermissionError(error, "Could not save permissions.") };
  }
}

export async function resetPermissionsAction(
  _prev: MatrixState,
  _formData: FormData,
): Promise<MatrixState> {
  try {
    const user = await assertPermission("users.manage");

    const { changes } = await resetPermissionMatrix(user);
    if (changes.length === 0) {
      return { ok: true, saved: "Permissions are already set to the built-in defaults." };
    }

    revalidatePath("/", "layout");
    revalidatePath("/access");
    return { ok: true, saved: "Restored the built-in defaults." };
  } catch (error) {
    return { error: safePermissionError(error, "Could not reset permissions.") };
  }
}
