import { recordAudit } from "@/lib/auth";
import { EXPORT_FILE_PREFIX } from "@/lib/brand";
import { sql } from "@/lib/db";
import {
  INVENTORY_COLUMN_FORMATS,
  INVENTORY_EXPORT_HEADER,
  STAKEHOLDER_EXPORT_HEADER,
  authenticateExportRequest,
  buildMultiExport,
  exportErrorResponse,
  isExportFormat,
  mapInventoryExportRow,
  mapStakeholderExportRow,
  parseItemExportFilters,
  parseMovementExportFilters,
  parsePositiveIntParam,
  parseStakeholderExportFilters,
  type ExportFormat,
  type Table,
} from "@/lib/export";
import type { ExportDatasetKey } from "@/lib/export-datasets";
import { getPermissionMatrix } from "@/lib/permissions";
import { listProjects } from "@/lib/projects";
import {
  listItems,
  listMovements,
  listStaffTasks,
  listStakeholders,
  listUsers,
  type AuditRow,
  type StakeholderFilters,
  type StakeholderRow,
} from "@/lib/queries";
import { canWith, type Permission } from "@/lib/roles";
import { isPriority, isTaskStatus } from "@/lib/timelines";

export const maxDuration = 60;

/** Every dataset that can be exported, and every permission required to access it. */
const DATASETS = {
  stakeholders: ["stakeholders.view"],
  inventory: ["inventory.view", "reports.view"],
  movements: ["inventory.view", "reports.view"],
  projects: ["projects.view"],
  timelines: ["timelines.view"],
  users: ["users.manage"],
  audit: ["audit.view"],
} as const satisfies Record<ExportDatasetKey, readonly Permission[]>;

type Dataset = keyof typeof DATASETS;

function isDataset(value: string): value is Dataset {
  return value in DATASETS;
}

function escapeIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, "\\$&");
}

const MAX_EXPORT_GROUPS = 200;

async function listStakeholdersForGroups(
  groupIds: number[],
  filters: Omit<StakeholderFilters, "groupId">,
): Promise<StakeholderRow[]> {
  if (groupIds.length <= 1) {
    return listStakeholders({ ...filters, groupId: groupIds[0] });
  }

  const where: string[] = ["s.group_id = ANY($1)"];
  const params: unknown[] = [groupIds];

  if (filters.search) {
    const n = params.length + 1;
    where.push(
      `(s.name ILIKE $${n} ESCAPE '\\' OR s.organisation ILIKE $${n} ESCAPE '\\' OR s.email ILIKE $${n} ESCAPE '\\'
        OR s.alt_email ILIKE $${n} ESCAPE '\\' OR s.phone ILIKE $${n} ESCAPE '\\' OR s.alt_phone ILIKE $${n} ESCAPE '\\'
        OR s.job_title ILIKE $${n} ESCAPE '\\' OR s.location ILIKE $${n} ESCAPE '\\' OR s.notes ILIKE $${n} ESCAPE '\\')`,
    );
    params.push(`%${escapeIlike(filters.search)}%`);
  }
  if (filters.has === "email") {
    where.push(
      "((s.email IS NOT NULL AND s.email <> '') OR (s.alt_email IS NOT NULL AND s.alt_email <> ''))",
    );
  }
  if (filters.has === "phone") {
    where.push(
      "((s.phone IS NOT NULL AND s.phone <> '') OR (s.alt_phone IS NOT NULL AND s.alt_phone <> ''))",
    );
  }
  if (filters.has === "nocontact") {
    where.push(
      "(s.email IS NULL OR s.email = '') AND (s.alt_email IS NULL OR s.alt_email = '') AND (s.phone IS NULL OR s.phone = '') AND (s.alt_phone IS NULL OR s.alt_phone = '')",
    );
  }

  const orderBy =
    filters.sort === "organisation"
      ? "lower(s.organisation) ASC NULLS LAST, lower(s.name) ASC"
      : filters.sort === "group"
        ? "lower(g.name) ASC NULLS LAST, lower(s.name) ASC"
        : filters.sort === "updated"
          ? "s.updated_at DESC"
          : "lower(s.name) ASC";

  const query = `
    SELECT s.*, g.name AS group_name
    FROM stakeholders s
    LEFT JOIN stakeholder_groups g ON g.id = s.group_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}, s.id ASC`;
  return sql.unsafe<StakeholderRow[]>(query, params as never[]);
}

/**
 * One endpoint for the advanced export: any combination of datasets, narrowed
 * by group, category, location or search filters, in CSV/XLSX/JSON.
 */
export async function GET(request: Request) {
  const auth = await authenticateExportRequest(request);
  if ("response" in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  const rawFormat = params.get("format")?.trim().toLowerCase();
  if (rawFormat && !isExportFormat(rawFormat)) {
    return exportErrorResponse("Invalid export format.", 400);
  }
  const format: ExportFormat = rawFormat && isExportFormat(rawFormat) ? rawFormat : "xlsx";

  const rawDatasetTokens = (params.get("datasets") ?? "stakeholders")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (rawDatasetTokens.length === 0) {
    return exportErrorResponse("Select at least one dataset to export.", 400);
  }
  const invalidDatasets = rawDatasetTokens.filter((d) => !isDataset(d));
  if (invalidDatasets.length > 0) {
    return exportErrorResponse(`Unknown dataset requested: ${invalidDatasets.join(", ")}`, 400);
  }
  const requested = Array.from(new Set(rawDatasetTokens as Dataset[]));

  const matrix = await getPermissionMatrix();
  const unauthorized = requested.filter(
    (d) => !DATASETS[d].every((perm) => canWith(matrix, auth.user.role, perm)),
  );
  if (unauthorized.length > 0) {
    return exportErrorResponse("You do not have permission to export one or more requested datasets.", 403);
  }
  const allowed = requested;

  const groupIds: number[] = [];
  const seenGroups = new Set<number>();
  for (const token of (params.get("groups") ?? "").split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const parsed = parsePositiveIntParam(trimmed);
    if (parsed.error) return exportErrorResponse(parsed.error, 400);
    if (parsed.value && !seenGroups.has(parsed.value)) {
      seenGroups.add(parsed.value);
      groupIds.push(parsed.value);
      if (groupIds.length > MAX_EXPORT_GROUPS) {
        return exportErrorResponse("Too many stakeholder groups requested.", 400);
      }
    }
  }

  const itemFilterResult = parseItemExportFilters(params);
  if (itemFilterResult.error) return exportErrorResponse(itemFilterResult.error, 400);

  const stakeholderFilterResult = parseStakeholderExportFilters(params);
  if (stakeholderFilterResult.error) return exportErrorResponse(stakeholderFilterResult.error, 400);

  const movementFilterResult = parseMovementExportFilters(params);
  if (movementFilterResult.error) return exportErrorResponse(movementFilterResult.error, 400);

  const tables: Table[] = [];

  if (allowed.includes("stakeholders")) {
    const sFilters = stakeholderFilterResult.filters!;
    const effectiveGroups =
      groupIds.length > 0 ? groupIds : sFilters.groupId ? [sFilters.groupId] : [];
    const people = await listStakeholdersForGroups(effectiveGroups, {
      search: sFilters.search,
      group: groupIds.length > 0 ? undefined : sFilters.group,
      has: sFilters.has,
      sort: sFilters.sort,
    });
    tables.push({
      name: "Stakeholders",
      header: STAKEHOLDER_EXPORT_HEADER,
      rows: people.map(mapStakeholderExportRow),
    });
  }

  if (allowed.includes("inventory")) {
    const items = await listItems(itemFilterResult.filters!);
    tables.push({
      name: "Inventory",
      header: INVENTORY_EXPORT_HEADER,
      rows: items.map(mapInventoryExportRow),
      columnFormats: INVENTORY_COLUMN_FORMATS,
    });
  }

  if (allowed.includes("movements")) {
    const movements = await listMovements({
      ...movementFilterResult.filters,
      limit: 100000,
    });
    tables.push({
      name: "Stock movements",
      header: ["When", "Type", "Item", "SKU", "Change", "Balance after", "Recorded by", "Note"],
      rows: movements.map((m) => [
        m.created_at,
        m.type,
        m.item_name,
        m.item_sku ?? "",
        m.type === "OUT" ? -Math.abs(m.quantity) : m.quantity,
        m.balance_after,
        m.user_name ?? "Removed user",
        m.note ?? "",
      ]),
      columnFormats: [
        { numFmt: "yyyy-mm-dd hh:mm" },
        undefined,
        undefined,
        undefined,
        { numFmt: "#,##0", align: "right" },
        { numFmt: "#,##0", align: "right" },
        undefined,
        undefined,
      ],
    });
  }

  if (allowed.includes("projects")) {
    const projects = await listProjects();
    tables.push({
      name: "Projects",
      header: [
        "Code",
        "Title",
        "Status",
        "IICA Phase",
        "Funding status",
        "Programme areas",
        "Tags",
        "Assigned staff",
        "Start date",
        "Target end",
        "Actual end",
        "Open actions",
        "Overdue actions",
        "Updates",
        "Lessons",
        "Stakeholders",
        "Funding summary",
        "Purpose",
        "Outcome summary",
      ],
      rows: projects.map((p) => [
        p.code ?? "",
        p.title,
        p.status_name,
        p.phase_name ?? "",
        p.funding_status_name ?? "",
        p.areas.map((a) => a.name).join("; "),
        p.tags.map((t) => t.name).join("; "),
        p.staff.map((s) => `${s.name} (${s.role})`).join("; "),
        p.start_date ?? "",
        p.target_end_date ?? "",
        p.actual_end_date ?? "",
        p.open_actions,
        p.overdue_actions,
        p.update_count,
        p.lesson_count,
        p.stakeholder_count,
        p.funding
          .map(
            (f) =>
              `${f.currency}: req ${f.requested.toFixed(2)} / app ${f.approved.toFixed(2)} / rec ${f.received.toFixed(2)}`,
          )
          .join("; "),
        p.purpose ?? "",
        p.outcome_summary ?? "",
      ]),
      columnFormats: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { numFmt: "#,##0", align: "right" },
        { numFmt: "#,##0", align: "right" },
        { numFmt: "#,##0", align: "right" },
        { numFmt: "#,##0", align: "right" },
        { numFmt: "#,##0", align: "right" },
        undefined,
        undefined,
        undefined,
      ],
    });
  }

  if (allowed.includes("timelines")) {
    const rawArea = params.get("area")?.trim() || undefined;
    const rawStatus = params.get("status")?.trim().toUpperCase();
    const rawPriority = params.get("priority")?.trim().toUpperCase();
    const rawOwner = parsePositiveIntParam(params.get("owner"));
    if (rawOwner.error) return exportErrorResponse(rawOwner.error, 400);

    const status = rawStatus && rawStatus !== "ALL" && isTaskStatus(rawStatus) ? rawStatus : undefined;
    const priority =
      rawPriority && rawPriority !== "ALL" && isPriority(rawPriority) ? rawPriority : undefined;

    const tasks = await listStaffTasks({
      area: rawArea && rawArea !== "ALL" ? rawArea : undefined,
      status,
      priority,
      lead: params.get("lead")?.trim() || undefined,
      ownerId: rawOwner.value,
      search: params.get("q")?.trim() || undefined,
    });
    tables.push({
      name: "Timelines",
      header: [
        "Area",
        "Title",
        "Lead",
        "Owner",
        "Origin",
        "Priority",
        "Status",
        "Progress (%)",
        "Start date",
        "End date",
        "Schedule note",
        "Progress note",
        "Comments",
      ],
      rows: tasks.map((t) => [
        t.area,
        t.title,
        t.lead ?? "",
        t.owner_name ?? "",
        t.origin ?? "",
        t.priority,
        t.status,
        t.progress ?? null,
        t.starts_on ?? "",
        t.ends_on ?? "",
        t.schedule_note ?? "",
        t.progress_note ?? "",
        t.comments ?? "",
      ]),
      columnFormats: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { numFmt: "#,##0", align: "right" },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    });
  }

  if (allowed.includes("users")) {
    const users = await listUsers();
    tables.push({
      name: "Users",
      header: ["Name", "Email", "Access level", "Status", "Last sign-in", "Added"],
      rows: users.map((u) => [
        u.name,
        u.email,
        u.role,
        u.status,
        u.last_login_at,
        u.created_at,
      ]),
      columnFormats: [
        undefined,
        undefined,
        undefined,
        undefined,
        { numFmt: "yyyy-mm-dd hh:mm" },
        { numFmt: "yyyy-mm-dd hh:mm" },
      ],
    });
  }

  if (allowed.includes("audit")) {
    // Oldest to newest to match the dataset description in export-datasets.ts.
    const logs = await sql<AuditRow[]>`
      SELECT id, user_label, action, entity, entity_id, details, created_at
      FROM audit_logs
      ORDER BY created_at ASC, id ASC
      LIMIT 100000`;
    tables.push({
      name: "Audit trail",
      header: ["When", "Who", "Action", "Entity", "Reference", "Details"],
      rows: logs.map((log) => [
        log.created_at,
        log.user_label ?? "System",
        log.action,
        log.entity,
        log.entity_id ?? "",
        log.details ?? "",
      ]),
      columnFormats: [
        { numFmt: "yyyy-mm-dd hh:mm" },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    });
  }

  const totalRows = tables.reduce((sum, table) => sum + table.rows.length, 0);
  try {
    await recordAudit({
      user: auth.user,
      action: "EXPORT",
      entity: tables.length === 1 ? allowed[0] : "export",
      details: `Format: ${format.toUpperCase()} · Datasets: ${allowed.join(", ")} · Rows: ${totalRows}`,
    });
  } catch (error) {
    console.error("Failed to record export audit entry:", error);
  }

  const filename =
    tables.length === 1
      ? `${EXPORT_FILE_PREFIX}-${tables[0].name.toLowerCase().replace(/\s+/g, "-")}`
      : `${EXPORT_FILE_PREFIX}-export`;

  return buildMultiExport({ format, filename, tables });
}
