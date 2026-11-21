import { recordAudit } from "@/lib/auth";
import { EXPORT_FILE_PREFIX } from "@/lib/brand";
import {
  STAKEHOLDER_EXPORT_HEADER,
  authenticateExportRequest,
  buildExport,
  exportErrorResponse,
  isExportFormat,
  mapStakeholderExportRow,
  parseStakeholderExportFilters,
  type ExportFormat,
} from "@/lib/export";
import { can } from "@/lib/permissions";
import { listStakeholders } from "@/lib/queries";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authenticateExportRequest(request);
  if ("response" in auth) return auth.response;

  if (!(await can(auth.user.role, "stakeholders.view"))) {
    return exportErrorResponse("Forbidden", 403);
  }

  const params = new URL(request.url).searchParams;
  const rawFormat = params.get("format")?.trim().toLowerCase();
  if (rawFormat && !isExportFormat(rawFormat)) {
    return exportErrorResponse("Invalid export format.", 400);
  }
  const format: ExportFormat = rawFormat && isExportFormat(rawFormat) ? rawFormat : "csv";

  const { filters, error } = parseStakeholderExportFilters(params);
  if (error || !filters) return exportErrorResponse(error ?? "Invalid filters", 400);

  const rows = (await listStakeholders(filters)).map(mapStakeholderExportRow);

  try {
    await recordAudit({
      user: auth.user,
      action: "EXPORT",
      entity: "stakeholder",
      details: `Format: ${format.toUpperCase()} · Rows: ${rows.length}`,
    });
  } catch (err) {
    console.error("Failed to record stakeholder export audit entry:", err);
  }

  return buildExport({
    format,
    filename: `${EXPORT_FILE_PREFIX}-stakeholders`,
    sheetName: "Stakeholders",
    header: STAKEHOLDER_EXPORT_HEADER,
    rows,
  });
}
