import "server-only";
import { getPermissionMatrix } from "./permissions";
import { canWith, type Permission, type Role } from "./roles";
import type { ExportDataset } from "@/components/export-dialog";

export type ExportDatasetKey =
  | "stakeholders"
  | "inventory"
  | "movements"
  | "projects"
  | "timelines"
  | "users"
  | "audit";

/** Kept beside the API route's own table so the dialog offers exactly what it serves. */
const DATASETS: (Omit<ExportDataset, "allowed"> & {
  key: ExportDatasetKey;
  permissions: readonly Permission[];
})[] = [
  {
    key: "stakeholders",
    label: "Stakeholders",
    hint: "Every contact, with organisation and contact details",
    permissions: ["stakeholders.view"],
  },
  {
    key: "inventory",
    label: "Inventory",
    hint: "Items with quantities, cost and valuation",
    permissions: ["inventory.view", "reports.view"],
  },
  {
    key: "movements",
    label: "Stock movements",
    hint: "The full receipt, issue and correction history",
    permissions: ["inventory.view", "reports.view"],
  },
  {
    key: "projects",
    label: "Projects",
    hint: "Project records, phases, status, staff and funding summary",
    permissions: ["projects.view"],
  },
  {
    key: "timelines",
    label: "Timelines",
    hint: "Targets, deliverables, owners, dates and progress",
    permissions: ["timelines.view"],
  },
  {
    key: "users",
    label: "Users",
    hint: "Accounts, access levels and last sign-in",
    permissions: ["users.manage"],
  },
  {
    key: "audit",
    label: "Audit trail",
    hint: "Every recorded action, oldest to newest",
    permissions: ["audit.view"],
  },
];

/**
 * Marks each dataset allowed or not for this person.
 *
 * `only` restricts the list to a section's own data: the Directory should not
 * offer stock movements or the audit trail just because the person could
 * technically export them from elsewhere. Omit it for the dashboard, which is
 * the one screen that spans everything.
 */
export async function exportDatasetsFor(
  role: Role,
  only?: readonly ExportDatasetKey[] | readonly string[],
): Promise<ExportDataset[]> {
  const matrix = await getPermissionMatrix();
  const source = only ? DATASETS.filter((d) => only.includes(d.key)) : DATASETS;
  return source.map(({ permissions, ...rest }) => ({
    ...rest,
    allowed: permissions.every((permission) => canWith(matrix, role, permission)),
  }));
}
