import { canWith, type Permission, type PermissionMatrix, type Role } from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
  /** Additional permissions where having any listed permission grants access. */
  anyPermission?: Permission[];
  description: string;
  /**
   * Extra paths that belong to this entry. A section can span more than one
   * route - Inventory covers both the catalogue and its movements - and the
   * sidebar should stay lit on all of them.
   */
  match?: string[];
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/** Returns true when a role is permitted to access the given navigation entry. */
export function canViewNavItem(
  matrix: PermissionMatrix,
  role: Role | undefined | null,
  item: NavItem,
): boolean {
  if (item.anyPermission && item.anyPermission.length > 0) {
    return item.anyPermission.some((perm) => canWith(matrix, role, perm));
  }
  return canWith(matrix, role, item.permission);
}

/** Icon names map to the lookup in `app-shell.tsx` (keeps this file server-safe). */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: "gauge",
        permission: "inventory.view",
        anyPermission: [
          "inventory.view",
          "projects.view",
          "calendar.view",
          "timelines.view",
          "reports.view",
        ],
        description: "Office pulse: inventory, schedule, projects and contacts",
      },
      {
        href: "/projects",
        label: "Projects",
        icon: "project",
        permission: "projects.view",
        description: "Project life cycle: people, funding, progress and lessons",
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: "calendar",
        permission: "calendar.view",
        description: "Meetings, leave, missions and holidays",
      },
      {
        href: "/timelines",
        label: "Timelines",
        icon: "checklist",
        permission: "timelines.view",
        description: "Tasks, leads and target dates",
      },
      {
        href: "/inventory",
        label: "Inventory",
        icon: "boxes",
        permission: "inventory.view",
        description: "Items and stock movements",
        match: ["/movements"],
      },
    ],
  },
  {
    title: "Directory",
    items: [
      {
        href: "/stakeholders",
        label: "Stakeholders",
        icon: "contacts",
        permission: "stakeholders.view",
        description: "Ministries, partners and contacts",
      },
      {
        href: "/vendors",
        label: "Vendors",
        icon: "briefcase",
        permission: "vendors.view",
        description: "Suppliers and service providers",
      },
    ],
  },
  {
    title: "Users & access",
    items: [
      {
        href: "/users",
        label: "Users",
        icon: "users",
        permission: "users.manage",
        description: "Staff accounts and sign-in status",
      },
      {
        href: "/access",
        label: "Access",
        icon: "key",
        permission: "users.manage",
        description: "Role permissions across sections",
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        href: "/taxonomy",
        label: "Reference lists",
        icon: "list",
        permission: "taxonomy.manage",
        anyPermission: ["taxonomy.manage", "stakeholders.manage"],
        description: "Inventory categories, storage locations and stakeholder groups",
      },
      {
        href: "/audit",
        label: "Audit trail",
        icon: "shield",
        permission: "audit.view",
        description: "Activity log",
      },
    ],
  },
];
