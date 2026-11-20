import "server-only";
import { cache } from "react";
import { NAV_SECTIONS, canViewNavItem } from "@/components/nav-config";
import type { CurrentUser, SqlExecutor } from "./auth";
import { sql } from "./db";
import {
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  canWith,
  isPermission,
  isRole,
  type Permission,
  type PermissionMatrix,
  type Role,
} from "./roles";

const MATRIX_LOCK_ID = 884201;

const CORE_BOOTSTRAP_PERMISSIONS = new Set<string>([
  "inventory.view",
  "inventory.manage",
  "movement.record",
  "taxonomy.manage",
  "reports.view",
  "stakeholders.view",
  "stakeholders.manage",
  "users.manage",
  "audit.view",
]);

function emptyMatrix(): PermissionMatrix {
  return { ADMIN: [], MANAGER: [], STAFF: [], VIEWER: [] };
}

function defaultPairs() {
  return ROLES.flatMap((role) =>
    DEFAULT_ROLE_PERMISSIONS[role].map((permission) => ({ role, permission })),
  );
}

function hasCorePermissions(rows: { permission: string }[]): boolean {
  return rows.some((row) => CORE_BOOTSTRAP_PERMISSIONS.has(row.permission));
}

function buildMatrix(rows: { role: string; permission: string }[]): PermissionMatrix {
  const matrix = emptyMatrix();
  for (const row of rows) {
    if (isRole(row.role) && isPermission(row.permission) && !matrix[row.role].includes(row.permission)) {
      matrix[row.role].push(row.permission);
    }
  }
  return withLocked(matrix);
}

/**
 * Seeds missing default permissions once when the matrix is empty or only has
 * partial legacy rows from pre-bootstrap `SCHEMA_SQL` (and has never been edited
 * via `/users?tab=access`), without re-granting intentionally revoked cells.
 */
async function bootstrapDefaultPermissions(): Promise<{ role: string; permission: string }[]> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MATRIX_LOCK_ID})`;
    const current = await tx<{ role: string; permission: string }[]>`
      SELECT role, permission FROM role_permissions`;
    if (current.length > 0 && hasCorePermissions(current)) return current;

    const [edited] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM audit_logs WHERE entity = 'permissions') AS exists`;
    if (edited?.exists) return current;

    const pairs = defaultPairs();
    if (pairs.length > 0) {
      await tx`INSERT INTO role_permissions ${tx(pairs)} ON CONFLICT DO NOTHING`;
    }
    return tx<{ role: string; permission: string }[]>`
      SELECT role, permission FROM role_permissions`;
  });
}

/**
 * The live matrix, read from `role_permissions`.
 *
 * Wrapped in React's `cache` so a page that checks ten permissions still makes
 * one query per request. It is deliberately not cached beyond the request: an
 * administrator changing the matrix should see it take effect on the next
 * navigation, not after a revalidation window.
 */
export const getPermissionMatrix = cache(async (): Promise<PermissionMatrix> => {
  let rows: { role: string; permission: string }[] = await sql<
    { role: string; permission: string }[]
  >`SELECT role, permission FROM role_permissions`;

  if (rows.length === 0 || !hasCorePermissions(rows)) {
    rows = await bootstrapDefaultPermissions();
  }

  return buildMatrix(rows);
});

/** The one cell that cannot be turned off, enforced on read as well as on write. */
function withLocked(matrix: PermissionMatrix): PermissionMatrix {
  if (!matrix[LOCKED.role].includes(LOCKED.permission)) {
    matrix[LOCKED.role].push(LOCKED.permission);
  }
  return matrix;
}

/** Describes what changed between two matrices, for the audit trail. */
export function diffPermissionMatrix(before: PermissionMatrix, after: PermissionMatrix): string[] {
  const changes: string[] = [];
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      const had = before[role].includes(permission);
      const has = after[role].includes(permission);
      if (had !== has) {
        changes.push(`${has ? "+" : "−"} ${ROLE_LABELS[role]}: ${permission}`);
      }
    }
  }
  return changes;
}

async function readMatrixLocked(tx: SqlExecutor): Promise<PermissionMatrix> {
  const current = await tx<{ role: string; permission: string }[]>`
    SELECT role, permission FROM role_permissions`;
  if (current.length > 0 && hasCorePermissions(current)) {
    return buildMatrix(current);
  }
  const [edited] = await tx<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM audit_logs WHERE entity = 'permissions') AS exists`;
  if (edited?.exists) return buildMatrix(current);
  return buildMatrix(defaultPairs());
}

async function writeMatrixAudit(
  tx: SqlExecutor,
  actor: CurrentUser,
  details: string,
): Promise<void> {
  await tx`
    INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
    VALUES (
      ${actor.userId},
      ${`${actor.name} (${actor.email})`},
      'UPDATE',
      'permissions',
      ${null},
      ${details}
    )`;
}

function assertNoMatrixEscalation(
  actor: CurrentUser,
  before: PermissionMatrix,
  after: PermissionMatrix,
): void {
  if (actor.role === "ADMIN") return;

  // Non-ADMIN users with users.manage cannot alter ADMIN role permissions.
  const beforeAdmin = new Set(before.ADMIN);
  const afterAdmin = new Set(after.ADMIN);
  if (
    beforeAdmin.size !== afterAdmin.size ||
    [...beforeAdmin].some((p) => !afterAdmin.has(p))
  ) {
    throw new Error("Your role cannot modify Administrator permissions.");
  }

  // Non-ADMIN users cannot grant any role a permission they do not hold themselves.
  const actorPerms = new Set(before[actor.role]);
  for (const role of ROLES) {
    for (const perm of after[role]) {
      const wasGranted = before[role].includes(perm);
      if (!wasGranted && !actorPerms.has(perm)) {
        throw new Error("Your role cannot grant permissions that you do not hold.");
      }
    }
  }
}

/** Writes the built-in defaults, replacing whatever is stored. */
export async function seedPermissions(): Promise<void> {
  const pairs = defaultPairs();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MATRIX_LOCK_ID})`;
    await tx`DELETE FROM role_permissions`;
    if (pairs.length > 0) await tx`INSERT INTO role_permissions ${tx(pairs)}`;
  });
}

/**
 * Atomically reads the live matrix under the advisory lock, enforces privilege
 * escalation rules, replaces `role_permissions`, and writes the audit trail
 * inside the same transaction.
 */
export async function savePermissionMatrix(
  matrix: PermissionMatrix,
  actor?: CurrentUser,
): Promise<{ changes: string[] }> {
  const normalized: PermissionMatrix = {
    ADMIN: [...new Set(matrix.ADMIN)],
    MANAGER: [...new Set(matrix.MANAGER)],
    STAFF: [...new Set(matrix.STAFF)],
    VIEWER: [...new Set(matrix.VIEWER)],
  };
  if (!normalized[LOCKED.role].includes(LOCKED.permission)) {
    normalized[LOCKED.role].push(LOCKED.permission);
  }
  const pairs = ROLES.flatMap((role) =>
    normalized[role].map((permission) => ({ role, permission })),
  );

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MATRIX_LOCK_ID})`;
    const before = await readMatrixLocked(tx);
    if (actor) {
      assertNoMatrixEscalation(actor, before, normalized);
    }
    const changes = diffPermissionMatrix(before, normalized);
    if (changes.length === 0) return { changes };

    await tx`DELETE FROM role_permissions`;
    if (pairs.length > 0) await tx`INSERT INTO role_permissions ${tx(pairs)}`;
    if (actor) {
      await writeMatrixAudit(tx, actor, changes.join(", "));
    }
    return { changes };
  });
}

/**
 * Atomically resets `role_permissions` to built-in defaults and logs the exact
 * diff inside the same advisory-locked transaction.
 */
export async function resetPermissionMatrix(actor: CurrentUser): Promise<{ changes: string[] }> {
  if (actor.role !== "ADMIN") {
    throw new Error("Your role cannot restore default permissions across all roles.");
  }
  const pairs = defaultPairs();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MATRIX_LOCK_ID})`;
    const before = await readMatrixLocked(tx);
    const changes = diffPermissionMatrix(before, DEFAULT_ROLE_PERMISSIONS);
    if (changes.length === 0) return { changes };

    await tx`DELETE FROM role_permissions`;
    if (pairs.length > 0) await tx`INSERT INTO role_permissions ${tx(pairs)}`;
    await writeMatrixAudit(tx, actor, `Reset to defaults: ${changes.join(", ")}`);
    return { changes };
  });
}

/** The everyday check. Pages needing many checks should load the matrix once instead. */
export async function can(
  role: Role | undefined | null,
  permission: Permission,
): Promise<boolean> {
  return canWith(await getPermissionMatrix(), role, permission);
}

/** First route in `NAV_SECTIONS` the role can open, falling back to `/profile`. */
export function defaultHomeForRole(
  matrix: PermissionMatrix,
  role: Role | undefined | null,
): string {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (canViewNavItem(matrix, role, item)) return item.href;
    }
  }
  return "/profile";
}
