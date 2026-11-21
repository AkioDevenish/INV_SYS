import "server-only";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import {
  consumeRateLimit,
  getRequestClientInfo,
  requireApiUser,
  type CurrentUser,
} from "./auth";
import { APP_NAME } from "./brand";
import { CONDITIONS } from "./conditions";
import { APP_TIMEZONE, formatDateTime } from "./format";
import type {
  ItemFilters,
  ItemRow,
  MovementFilters,
  StakeholderFilters,
  StakeholderRow,
} from "./queries";

export const EXPORT_FORMATS = ["csv", "xlsx", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type CellValue = string | number | Date | null | undefined;

export type ColumnFormat = {
  /** Excel number format string, e.g. "#,##0.00" or "yyyy-mm-dd hh:mm". */
  numFmt?: string;
  /** Horizontal alignment override for data cells in this column. */
  align?: "left" | "right" | "center";
};

export type Table = {
  /** Becomes the worksheet name, the JSON key and part of the filename. */
  name: string;
  header: string[];
  rows: CellValue[][];
  /** Optional per-column formatting applied when rendering XLSX. */
  columnFormats?: (ColumnFormat | undefined)[];
};

const TRINIDAD_OFFSET_MS = 4 * 3600 * 1000;
const FORMULA_PREFIX_RE = /^\s*[=+\-@\t\r]/;
const MAX_PG_INT = 2_147_483_647;
const EXPORT_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 5 * 60_000,
  lockoutBaseMs: 60_000,
  maxLockoutMs: 5 * 60_000,
};

const ITEM_STOCKS = ["all", "low", "out", "attention"] as const;
const ITEM_SORTS = ["name", "quantity", "value", "updated"] as const;
const ITEM_GROUPS = ["iica", "cabi", "filling-cabinet"] as const;
const MOVEMENT_TYPES = ["IN", "OUT", "ADJUST"] as const;
const STAKEHOLDER_HAS = ["all", "email", "phone", "nocontact"] as const;
const STAKEHOLDER_SORTS = ["name", "organisation", "group", "updated"] as const;

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function exportErrorResponse(
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export async function authenticateExportRequest(
  request?: Request,
): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const auth = await requireApiUser();
  if (!auth.ok) {
    return {
      response: exportErrorResponse(
        auth.response.status === 401 ? "Unauthorized" : "Password change required",
        auth.response.status,
      ),
    };
  }

  const { ip } = await getRequestClientInfo(request);
  const userLimit = consumeRateLimit("export:user", String(auth.user.userId), EXPORT_RATE_LIMIT);
  if (!userLimit.allowed) {
    return {
      response: exportErrorResponse("Too many export requests. Please wait a moment and try again.", 429, {
        "Retry-After": String(userLimit.retryAfterSeconds),
      }),
    };
  }
  if (ip !== "unknown") {
    const ipLimit = consumeRateLimit("export:ip", ip, {
      ...EXPORT_RATE_LIMIT,
      maxRequests: EXPORT_RATE_LIMIT.maxRequests * 2,
    });
    if (!ipLimit.allowed) {
      return {
        response: exportErrorResponse("Too many export requests. Please wait a moment and try again.", 429, {
          "Retry-After": String(ipLimit.retryAfterSeconds),
        }),
      };
    }
  }

  return { user: auth.user };
}

export function parsePositiveIntParam(
  raw: string | null,
): { value?: number; error?: string } {
  if (raw === null) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (!/^\d+$/.test(trimmed)) {
    return { error: "Numeric filter parameter must be a positive 32-bit integer." };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PG_INT) {
    return { error: "Numeric filter parameter must be a positive 32-bit integer." };
  }
  return { value: n };
}

export function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): { value?: T; error?: string } {
  if (raw === null) return { value: fallback };
  const trimmed = raw.trim();
  if (!trimmed) return { value: fallback };
  if ((allowed as readonly string[]).includes(trimmed)) {
    return { value: trimmed as T };
  }
  return { error: `Invalid filter value: ${trimmed}` };
}

export function parseItemExportFilters(
  params: URLSearchParams,
): { filters?: ItemFilters; error?: string } {
  const category = parsePositiveIntParam(params.get("category"));
  if (category.error) return { error: category.error };
  const location = parsePositiveIntParam(params.get("location"));
  if (location.error) return { error: location.error };
  const stock = parseEnumParam(params.get("stock"), ITEM_STOCKS, "all");
  if (stock.error) return { error: stock.error };
  const sort = parseEnumParam(params.get("sort"), ITEM_SORTS, "name");
  if (sort.error) return { error: sort.error };

  const rawGroup = params.get("locationGroup")?.trim();
  let locationGroup: ItemFilters["locationGroup"];
  if (rawGroup) {
    if (!(ITEM_GROUPS as readonly string[]).includes(rawGroup)) {
      return { error: `Invalid locationGroup: ${rawGroup}` };
    }
    locationGroup = rawGroup as ItemFilters["locationGroup"];
  }

  const rawCondition = params.get("condition")?.trim();
  let condition: string | undefined;
  if (rawCondition) {
    if (rawCondition !== "flagged" && !(CONDITIONS as readonly string[]).includes(rawCondition)) {
      return { error: `Invalid condition: ${rawCondition}` };
    }
    condition = rawCondition;
  }

  return {
    filters: {
      search: params.get("q")?.trim() || undefined,
      categoryId: category.value,
      locationId: location.value,
      stock: stock.value,
      condition,
      locationGroup,
      sort: sort.value,
    },
  };
}

export function parseStakeholderExportFilters(
  params: URLSearchParams,
): { filters?: StakeholderFilters; error?: string } {
  const rawGroup = params.get("group");
  let group: StakeholderFilters["group"];
  let groupId: number | undefined;
  if (rawGroup !== null) {
    const trimmedGroup = rawGroup.trim();
    if (trimmedGroup === "ungrouped") {
      group = "ungrouped";
    } else if (trimmedGroup) {
      const parsedGroup = parsePositiveIntParam(trimmedGroup);
      if (parsedGroup.error) {
        return {
          error: 'Group filter parameter must be a positive 32-bit integer or "ungrouped".',
        };
      }
      groupId = parsedGroup.value;
    }
  }
  const has = parseEnumParam(params.get("has"), STAKEHOLDER_HAS, "all");
  if (has.error) return { error: has.error };
  const sort = parseEnumParam(params.get("sort"), STAKEHOLDER_SORTS, "name");
  if (sort.error) return { error: sort.error };

  return {
    filters: {
      search: params.get("q")?.trim() || undefined,
      group,
      groupId,
      has: has.value,
      sort: sort.value,
    },
  };
}

export function parseMovementExportFilters(
  params: URLSearchParams,
): { filters?: MovementFilters; error?: string } {
  const item = parsePositiveIntParam(params.get("item"));
  if (item.error) return { error: item.error };

  const rawType = params.get("type")?.trim().toUpperCase();
  let type: MovementFilters["type"];
  if (rawType && rawType !== "ALL") {
    if (!(MOVEMENT_TYPES as readonly string[]).includes(rawType)) {
      return { error: `Invalid movement type: ${rawType}` };
    }
    type = rawType as MovementFilters["type"];
  }

  return {
    filters: {
      search: params.get("q")?.trim() || undefined,
      itemId: item.value,
      type,
    },
  };
}

export const INVENTORY_EXPORT_HEADER = [
  "SKU",
  "Name",
  "Category",
  "Location",
  "Unit",
  "Quantity",
  "Minimum",
  "Unit cost",
  "Total value",
  "Condition",
  "Condition note",
  "Supplier",
  "Description",
  "Last updated",
];

export const INVENTORY_COLUMN_FORMATS: (ColumnFormat | undefined)[] = [
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  { numFmt: "#,##0", align: "right" },
  { numFmt: "#,##0", align: "right" },
  { numFmt: "#,##0.00", align: "right" },
  { numFmt: "#,##0.00", align: "right" },
  undefined,
  undefined,
  undefined,
  undefined,
  { numFmt: "yyyy-mm-dd hh:mm" },
];

export function mapInventoryExportRow(item: ItemRow): CellValue[] {
  return [
    item.sku ?? "",
    item.name,
    item.category_name ?? "",
    item.location_name ?? "",
    item.unit,
    item.quantity,
    item.min_quantity,
    item.unit_cost,
    Number((item.quantity * item.unit_cost).toFixed(2)),
    item.condition,
    item.condition_note ?? "",
    item.supplier ?? "",
    item.description ?? "",
    item.updated_at,
  ];
}

export const STAKEHOLDER_EXPORT_HEADER = [
  "Name",
  "Organisation",
  "Role",
  "Group",
  "Email",
  "Alternate email",
  "Phone",
  "Alternate phone",
  "Location",
  "Gender",
  "Age group",
  "Website",
  "Social media",
  "Notes",
];

export function mapStakeholderExportRow(p: StakeholderRow): CellValue[] {
  return [
    p.name,
    p.organisation ?? "",
    p.job_title ?? "",
    p.group_name ?? "",
    p.email ?? "",
    p.alt_email ?? "",
    p.phone ?? "",
    p.alt_phone ?? "",
    p.location ?? "",
    p.gender ?? "",
    p.age_group ?? "",
    p.website ?? "",
    p.social ?? "",
    p.notes ?? "",
  ];
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) for text values — including
 * values with leading whitespace before `=`, `+`, `-`, `@`, `\t`, or `\r` — while
 * leaving real numeric values untouched.
 */
export function neutralizeFormulaString(text: string): string {
  return FORMULA_PREFIX_RE.test(text) ? `'${text}` : text;
}

function trinidadStampDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sanitizeFilenameSlug(raw: string): string {
  const clean = raw
    .replace(/[\r\n\0"/\\<>:|?*]+/g, "-")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return clean || "export";
}

function contentDispositionHeader(base: string, ext: string): string {
  const safeBase = sanitizeFilenameSlug(base);
  const full = `${safeBase}.${ext}`;
  return `attachment; filename="${full}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

function uniqueSheetName(raw: string, usedLower: Set<string>): string {
  const cleaned =
    raw
      .replace(/[:\\/?*[\]]/g, "-")
      .replace(/^'+|'+$/g, "")
      .trim()
      .slice(0, 31) || "Sheet";

  if (!usedLower.has(cleaned.toLowerCase())) {
    usedLower.add(cleaned.toLowerCase());
    return cleaned;
  }

  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!usedLower.has(candidate.toLowerCase())) {
      usedLower.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `Sheet-${usedLower.size + 1}`.slice(0, 31);
  usedLower.add(fallback.toLowerCase());
  return fallback;
}

function csvCell(value: CellValue): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  const rawText = value instanceof Date ? formatDateTime(value) : String(value);
  const safe = neutralizeFormulaString(rawText);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function xlsxCellValue(value: CellValue): string | number | Date | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    // ExcelJS derives serial numbers using UTC epoch milliseconds, so shift by
    // UTC-4 to write exact Trinidad wall-clock dates/times into Excel cells.
    return new Date(value.getTime() - TRINIDAD_OFFSET_MS);
  }
  return neutralizeFormulaString(String(value));
}

function jsonCellValue(value: CellValue): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function uniqueJsonKeys(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((raw, index) => {
    const base = raw || `column_${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function maxCellDisplayWidth(value: CellValue, format?: ColumnFormat): number {
  if (value == null) return 0;
  if (value instanceof Date) return 18;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    const text = format?.numFmt?.includes(".") ? value.toFixed(2) : String(value);
    return text.length;
  }
  return String(value)
    .split(/\r?\n/)
    .reduce((max, line) => Math.max(max, line.length), 0);
}

function computeColumnDefs(table: Table): Partial<ExcelJS.Column>[] {
  return table.header.map((title, index) => {
    const fmt = table.columnFormats?.[index];
    const widest = table.rows.reduce(
      (max, row) => Math.max(max, maxCellDisplayWidth(row[index], fmt)),
      0,
    );
    // Reserve +4 chars beyond header length so Excel's AutoFilter button does
    // not overlap short header titles.
    const width = Math.min(Math.max(widest + 2, title.length + 4, 12), 50);
    return {
      width,
      style: {
        alignment: {
          wrapText: true,
          vertical: "top",
          ...(fmt?.align ? { horizontal: fmt.align } : {}),
        },
        ...(fmt?.numFmt ? { numFmt: fmt.numFmt } : {}),
      },
    };
  });
}

function streamWorkbookResponse(tables: Table[], base: string): NextResponse {
  const passThrough = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: passThrough,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = APP_NAME;
  workbook.created = new Date();

  void (async () => {
    try {
      const usedSheets = new Set<string>();
      for (const table of tables) {
        const sheetName = uniqueSheetName(table.name, usedSheets);
        const sheet = workbook.addWorksheet(sheetName, {
          views: [{ state: "frozen", ySplit: 1 }],
        });

        sheet.columns = computeColumnDefs(table);

        if (table.header.length > 0) {
          const head = sheet.addRow(table.header);
          head.height = 22;
          head.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14477D" } };
            cell.alignment = { vertical: "middle", wrapText: false };
          });
          head.commit();
        }

        for (const rowValues of table.rows) {
          const row = sheet.addRow(rowValues.map(xlsxCellValue));
          row.commit();
        }

        if (table.header.length > 0) {
          sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: Math.max(1, table.rows.length + 1), column: table.header.length },
          };
        }
        sheet.commit();
      }
      await workbook.commit();
    } catch (error) {
      console.error("XLSX workbook stream error:", error);
      passThrough.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  const webStream = Readable.toWeb(passThrough) as unknown as BodyInit;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionHeader(base, "xlsx"),
      ...NO_STORE_HEADERS,
    },
  });
}

function buildJsonResponse(tables: Table[], base: string, unwrapSingle: boolean): NextResponse {
  const serializeTable = (t: Table) => {
    const keys = uniqueJsonKeys(t.header);
    return t.rows.map((row) =>
      Object.fromEntries(keys.map((key, i) => [key, jsonCellValue(row[i])])),
    );
  };

  const payload =
    unwrapSingle && tables.length === 1
      ? serializeTable(tables[0])
      : Object.fromEntries(tables.map((t) => [t.name, serializeTable(t)]));

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": contentDispositionHeader(base, "json"),
      ...NO_STORE_HEADERS,
    },
  });
}

function buildCsvResponse(tables: Table[], base: string): NextResponse {
  const blocks = tables.map((table) => {
    const body = [table.header, ...table.rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    return tables.length > 1 ? `# ${table.name}\r\n${body}` : body;
  });

  // Explicit BOM so Excel decodes UTF-8 characters cleanly.
  return new NextResponse(`\uFEFF${blocks.join("\r\n\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionHeader(base, "csv"),
      ...NO_STORE_HEADERS,
    },
  });
}

function renderExport({
  format,
  filename,
  tables,
  unwrapSingleJson,
}: {
  format: ExportFormat;
  filename: string;
  tables: Table[];
  unwrapSingleJson: boolean;
}): NextResponse {
  const base = `${sanitizeFilenameSlug(filename)}-${trinidadStampDate()}`;
  if (format === "json") return buildJsonResponse(tables, base, unwrapSingleJson);
  if (format === "xlsx") return streamWorkbookResponse(tables, base);
  return buildCsvResponse(tables, base);
}

/**
 * Builds a download from one or more tables.
 *
 * Excel gets a worksheet per table, JSON gets an object keyed by table name,
 * and CSV stacks tables with a heading line between them.
 */
export async function buildMultiExport({
  format,
  filename,
  tables,
}: {
  format: ExportFormat;
  filename: string;
  tables: Table[];
}): Promise<NextResponse> {
  return renderExport({ format, filename, tables, unwrapSingleJson: false });
}

/**
 * Builds a single-table download (top-level JSON array when `format === "json"`),
 * sharing the exact same Excel, CSV and header pipeline as `buildMultiExport`.
 */
export async function buildExport({
  format,
  filename,
  sheetName,
  header,
  rows,
  columnFormats,
}: {
  format: ExportFormat;
  /** Without an extension - the right one is appended per format. */
  filename: string;
  sheetName: string;
  header: string[];
  rows: CellValue[][];
  columnFormats?: (ColumnFormat | undefined)[];
}): Promise<NextResponse> {
  return renderExport({
    format,
    filename,
    tables: [{ name: sheetName, header, rows, columnFormats }],
    unwrapSingleJson: true,
  });
}
