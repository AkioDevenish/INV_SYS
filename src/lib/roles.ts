export const ROLES = ["ADMIN", "MANAGER", "STAFF", "VIEWER"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Full control, including user accounts, settings and the audit trail.",
  MANAGER: "Manages the catalogue and the stakeholder directory.",
  STAFF: "Records stock movements in and out of the warehouse.",
  VIEWER: "Read-only access to inventory, stakeholders and reports.",
};

/**
 * Every permission the app checks. Anything not listed for a role is denied.
 */
export const PERMISSIONS = [
  "inventory.view",
  "inventory.manage",
  "movement.record",
  "taxonomy.manage",
  "reports.view",
  "stakeholders.view",
  "stakeholders.manage",
  "vendors.view",
  "vendors.manage",
  "users.manage",
  "audit.view",
  "calendar.view",
  "calendar.manage",
  "timelines.view",
  "timelines.manage",
  "projects.view",
  "projects.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The starting point, not the live answer. These seed `role_permissions` on
 * first run and back the "Reset to defaults" button; what the app actually
 * enforces is read from the database - see `lib/permissions.ts`.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  VIEWER: [
    "inventory.view",
    "reports.view",
    "stakeholders.view",
    "vendors.view",
    "calendar.view",
    "timelines.view",
    "projects.view",
  ],
  STAFF: [
    "inventory.view",
    "reports.view",
    "stakeholders.view",
    "vendors.view",
    "movement.record",
    "calendar.view",
    // View only. Updating progress on a task you are accountable for is a
    // right of ownership, not of this permission - see updateProgressAction.
    "timelines.view",
    // View only. People assigned to a project may still add its updates and
    // lessons and close their own actions - see lib/projects.ts.
    "projects.view",
  ],
  MANAGER: [
    "inventory.view",
    "reports.view",
    "movement.record",
    "inventory.manage",
    "taxonomy.manage",
    "stakeholders.view",
    "stakeholders.manage",
    "vendors.view",
    "vendors.manage",
    "calendar.view",
    "calendar.manage",
    "timelines.view",
    "timelines.manage",
    "projects.view",
    "projects.manage",
  ],
  ADMIN: [...PERMISSIONS],
};

/** A permission map in the shape the app passes around. */
export type PermissionMatrix = Record<Role, Permission[]>;

/** Synchronous check against an already-loaded matrix. */
export function canWith(
  matrix: PermissionMatrix,
  role: Role | undefined | null,
  permission: Permission,
): boolean {
  if (!role) return false;
  return matrix[role]?.includes(permission) ?? false;
}

/**
 * Without `users.manage` an administrator could not reach the screen that edits
 * the matrix, and the system would be permanently unadministrable. This one
 * cell is therefore fixed, in the UI and on the server.
 */
export const LOCKED: { role: Role; permission: Permission } = {
  role: "ADMIN",
  permission: "users.manage",
};

export function isLocked(role: Role, permission: Permission): boolean {
  return role === LOCKED.role && permission === LOCKED.permission;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
