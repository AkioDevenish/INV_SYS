import type { Permission } from "./roles";

/**
 * What each permission actually means, in the words the screen uses.
 *
 * `grants` is what somebody with the box ticked can do; `denies` is what they
 * lose without it. Spelling out both is the point - a matrix of ticks tells you
 * nothing about consequences, and "can they see the audit trail?" is exactly
 * the question an administrator needs answered before granting anything.
 */
export type PermissionCopy = {
  label: string;
  grants: string;
  denies: string;
};

export const PERMISSION_COPY: Record<Permission, PermissionCopy> = {
  "inventory.view": {
    label: "View inventory",
    grants: "Open Dashboard, Inventory and any item's full record, including cost and valuation.",
    denies: "Dashboard and Inventory are hidden from the sidebar and their pages return access denied.",
  },
  "inventory.manage": {
    label: "Create & edit items",
    grants: "Add new items, edit any field, and delete items along with their stock history.",
    denies: "Items are read-only. No New item button, no edit or delete on any row.",
  },
  "movement.record": {
    label: "Record stock movements",
    grants: "Receive, issue and correct stock. Each movement is stamped with their name.",
    denies: "Stock movements is read-only - they see the history but cannot add to it.",
  },
  "taxonomy.manage": {
    label: "Manage categories & locations",
    grants: "Create, rename and delete the categories and locations items are filed under.",
    denies: "Reference lists are hidden unless they can also manage stakeholder groups.",
  },
  "reports.view": {
    label: "View reports & exports",
    grants: "See valuation, totals and the charts on the dashboard, and download exports.",
    denies: "The dashboard shows the stock snapshot only, with no financial figures or export.",
  },
  "stakeholders.view": {
    label: "View the stakeholder directory",
    grants: "Search Stakeholders and open any contact, including phone and email.",
    denies: "Stakeholders is hidden from the sidebar and its pages are blocked.",
  },
  "stakeholders.manage": {
    label: "Add, edit & delete stakeholders",
    grants: "Create contacts, edit any field, add groups, and delete contacts permanently.",
    denies: "The directory is read-only. No New stakeholder button and no row actions.",
  },
  "vendors.view": {
    label: "View vendors & contracts",
    grants: "Open the Vendors directory, contract schedules and service history.",
    denies: "Vendors is hidden from the sidebar and its pages and exports are blocked.",
  },
  "vendors.manage": {
    label: "Add, edit & delete vendors",
    grants: "Create and edit vendors, import spreadsheets, and log or update service engagements.",
    denies: "Vendors is read-only. No create, edit, import or delete actions.",
  },
  "users.manage": {
    label: "Manage user accounts",
    grants:
      "Create accounts, set passwords, change anyone's access level, disable and delete accounts, and edit this matrix.",
    denies: "Users & Access is hidden. They cannot see who else has an account.",
  },
  "audit.view": {
    label: "View the audit trail",
    grants: "See every recorded action by every person, including sign-ins and deletions.",
    denies: "Audit trail is hidden. Their own actions are still recorded regardless.",
  },
  "calendar.view": {
    label: "View shared calendar",
    grants: "View shared meetings, leave, missions and deadlines.",
    denies: "The shared calendar is hidden from the sidebar.",
  },
  "calendar.manage": {
    label: "Create & manage calendar events",
    grants: "Create, edit and delete shared calendar events.",
    denies: "Calendar events are read-only.",
  },
  "timelines.view": {
    label: "See timelines",
    grants: "Read the targets and timelines every area of the office is working to.",
    denies: "Timelines is hidden from the sidebar and its page is blocked.",
  },
  "timelines.manage": {
    label: "Update timelines",
    grants: "Add tasks, change status and progress, and import a timelines workbook.",
    denies: "Timelines can be read but not changed.",
  },
  "projects.view": {
    label: "See projects",
    grants: "Open every project record: people, funding, updates, actions, documents and lessons.",
    denies: "Projects is hidden from the sidebar and its pages are blocked.",
  },
  "projects.manage": {
    label: "Manage projects",
    grants: "Create and edit projects and all their records, and edit the project reference lists.",
    denies: "Projects are read-only, except updates and lessons on projects the person is assigned to.",
  },
};

/** The matrix is grouped into short thematic lists for readability. */
export const PERMISSION_GROUPS: { title: string; note: string; permissions: Permission[] }[] = [
  {
    title: "Assets & supplies",
    note: "Stock, items and how they are filed",
    permissions: ["inventory.view", "inventory.manage", "movement.record", "taxonomy.manage"],
  },
  {
    title: "Stakeholders",
    note: "The contact directory",
    permissions: ["stakeholders.view", "stakeholders.manage"],
  },
  {
    title: "Vendors",
    note: "Suppliers, contracts and service history",
    permissions: ["vendors.view", "vendors.manage"],
  },
  {
    title: "Timelines",
    note: "What each area is working to",
    permissions: ["timelines.view", "timelines.manage"],
  },
  {
    title: "Projects",
    note: "The project life cycle record",
    permissions: ["projects.view", "projects.manage"],
  },
  {
    title: "Reporting & administration",
    note: "Figures, accounts and accountability",
    permissions: ["reports.view", "calendar.view", "calendar.manage", "users.manage", "audit.view"],
  },
];
