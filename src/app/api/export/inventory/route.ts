import { recordAudit } from "@/lib/auth";
import { EXPORT_FILE_PREFIX } from "@/lib/brand";
import {
  INVENTORY_COLUMN_FORMATS,
  INVENTORY_EXPORT_HEADER,
  authenticateExportRequest,
  buildExport,
  exportErrorResponse,
  isExportFormat,
  mapInventoryExportRow,
  parseItemExportFilters,
  type ExportFormat,
} from "@/lib/export";
import { getPermissionMatrix } from "@/lib/permissions";
import { listItems } from "@/lib/queries";
import { canWith } from "@/lib/roles";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authenticateExportRequest(request);
  if ("response" in auth) return auth.response;

  const matrix = await getPermissionMatrix();
  if (
    !canWith(matrix, auth.user.role, "inventory.view") ||
    !canWith(matrix, auth.user.role, "reports.view")
  ) {
    return exportErrorResponse("Forbidden", 403);
  }

  const params = new URL(request.url).searchParams;
  const rawFormat = params.get("format")?.trim().toLowerCase();
  if (rawFormat && !isExportFormat(rawFormat)) {
    return exportErrorResponse("Invalid export format.", 400);
  }
  const format: ExportFormat = rawFormat && isExportFormat(rawFormat) ? rawFormat : "csv";

  const { filters, error } = parseItemExportFilters(params);
  if (error || !filters) return exportErrorResponse(error ?? "Invalid filters", 400);

  const rows = (await listItems(filters)).map(mapInventoryExportRow);

  try {
    await recordAudit({
      user: auth.user,
      action: "EXPORT",
      entity: "inventory",
      details: `Format: ${format.toUpperCase()} · Rows: ${rows.length}`,
    });
  } catch (err) {
    console.error("Failed to record inventory export audit entry:", err);
  }

  return buildExport({
    format,
    filename: `${EXPORT_FILE_PREFIX}-inventory`,
    sheetName: "Inventory",
    header: INVENTORY_EXPORT_HEADER,
    rows,
    columnFormats: INVENTORY_COLUMN_FORMATS,
  });
}
