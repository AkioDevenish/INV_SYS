import "server-only";
import ExcelJS from "exceljs";
import { sql } from "./db";
import { recordAudit, type CurrentUser } from "./auth";
import { isRetiredCondition, parseConditionInput } from "./conditions";
import { normalizeSku } from "./sku";

/**
 * Importing a spreadsheet into a live catalogue is an enrichment, not a
 * replacement. A row whose item already exists never overwrites what is there;
 * it only fills the fields that are still blank. That is the whole contract,
 * and everything below exists to keep it.
 */

export const MAX_INVENTORY_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_PG_INT = 2_147_483_647;
const MAX_UNIT_COST = 999_999_999_999.99;

export type ImportReport = {
  created: number;
  enriched: number;
  unchanged: number;
  /** How many items each column filled in, so the result says what it did. */
  filled: Record<string, number>;
  skipped: { row: number; reason: string }[];
  unknownCategories: string[];
  unknownLocations: string[];
  warnings: string[];
  sheet: string;
};

/** Columns we will fill on an item that already exists. */
const FILLABLE = [
  "description",
  "supplier",
  "category_id",
  "location_id",
  "unit_cost",
  "min_quantity",
  "condition_note",
] as const;

/**
 * Header names we accept, lower-cased. The first list matches what the app's
 * own export writes, so a file exported from here can be edited and fed
 * straight back in.
 */
const HEADERS: Record<string, string[]> = {
  sku: ["sku", "asset code", "sku / asset code", "asset tag", "code"],
  name: ["name", "item", "item name", "description of item"],
  category: ["category"],
  location: ["location", "room", "office"],
  unit: ["unit", "uom", "unit of measure"],
  quantity: ["quantity", "qty", "on hand", "count"],
  min_quantity: ["minimum", "min", "min quantity", "minimum quantity", "reorder level"],
  unit_cost: ["unit cost", "cost", "price", "unit price"],
  supplier: ["supplier", "vendor"],
  description: ["description", "notes", "note"],
  condition: ["condition"],
  condition_note: ["condition note", "condition notes"],
};

function normName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Strips the single leading apostrophe that CSV/XLSX exports prepend to
 * neutralize formula characters (=, +, -, @, tab, CR) so exported sheets
 * round-trip cleanly on re-import.
 */
function stripFormulaNeutralization(value: string): string {
  return value.replace(/^'(?=\s*[=+\-@\t\r])/, "");
}

/**
 * A cell can hold rich text, a formula result, a hyperlink or a date, and each
 * of those is an object rather than a string. Reading `.text` blindly is how
 * you end up importing "[object Object]" as somebody's name.
 */
function readCellValue(value: unknown): { text: string; formulaError?: string } {
  if (value === null || value === undefined) return { text: "" };
  if (typeof value === "string") return { text: stripFormulaNeutralization(value).trim() };
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value) };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10) };
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.error === "string") {
      return { text: "", formulaError: v.error };
    }
    if (Array.isArray(v.richText)) {
      const joined = (v.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
      return { text: stripFormulaNeutralization(joined).trim() };
    }
    if (v.result !== undefined) return readCellValue(v.result);
    if (v.text !== undefined) return readCellValue(v.text);
    if (v.hyperlink !== undefined) return readCellValue(v.hyperlink);
  }
  return { text: "" };
}

function cellText(value: unknown): string {
  return readCellValue(value).text;
}

function numberFrom(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Tolerates "$1,250.00", "1.200,50", and "1 250,00" style entries.
  let cleaned = trimmed.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replaceAll(".", "").replace(",", ".");
    } else {
      cleaned = cleaned.replaceAll(",", "");
    }
  } else if (lastComma !== -1) {
    cleaned = cleaned.replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) ?? []).length > 1) {
    cleaned = cleaned.replaceAll(".", "");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

type SheetRow = { row: number; values: Record<string, string> };

/** Locates the header row, then reads everything under it by column name. */
function readSheet(sheet: ExcelJS.Worksheet): {
  rows: SheetRow[];
  warnings: string[];
  error?: string;
} {
  let headerRow = 0;
  let mapping: Record<number, string> = {};
  const warnings: string[] = [];

  // Sheets often carry a title or a blank line before the real header.
  const limit = Math.min(sheet.rowCount, 15);
  for (let r = 1; r <= limit; r++) {
    const candidate: Record<number, string> = {};
    const seenFields = new Map<string, string>();
    const rowWarnings: string[] = [];
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const rawLabel = cellText(cell.value);
      const label = rawLabel.toLowerCase().replace(/\s+/g, " ").trim();
      for (const [field, names] of Object.entries(HEADERS)) {
        if (!names.includes(label)) continue;
        const prev = seenFields.get(field);
        if (prev) {
          rowWarnings.push(
            `Duplicate "${field}" column ("${prev}" and "${rawLabel}"); using "${prev}".`,
          );
        } else {
          seenFields.set(field, rawLabel);
          candidate[col] = field;
        }
        break;
      }
    });
    if (Object.values(candidate).includes("sku") || Object.values(candidate).includes("name")) {
      headerRow = r;
      mapping = candidate;
      warnings.push(...rowWarnings);
      break;
    }
  }

  if (!headerRow) {
    return {
      rows: [],
      warnings: [],
      error: "No header row found. The sheet needs a SKU or Name column.",
    };
  }

  const rows: SheetRow[] = [];
  let formulaErrorCount = 0;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const values: Record<string, string> = {};
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const field = mapping[col];
      if (!field) return;
      const parsed = readCellValue(cell.value);
      if (parsed.formulaError) {
        formulaErrorCount++;
        if (formulaErrorCount <= 10) {
          warnings.push(
            `Row ${r}, column "${field}": formula error (${parsed.formulaError}) was ignored.`,
          );
        }
      }
      values[field] = parsed.text;
    });
    if (Object.values(values).some((v) => v !== "")) rows.push({ row: r, values });
  }
  if (formulaErrorCount > 10) {
    warnings.push(
      `And ${formulaErrorCount - 10} additional cell formula error${formulaErrorCount - 10 === 1 ? "" : "s"} were ignored.`,
    );
  }
  return { rows, warnings };
}

/** Empty (or default 0 for NOT NULL cost/minimum when incoming > 0) means unset. */
function isUnset(column: string, current: unknown, incomingValue: string | number | null): boolean {
  if (column === "unit_cost" || column === "min_quantity") {
    // Columns are NOT NULL DEFAULT 0 in Postgres, so 0 represents "not set yet";
    // ignore incoming 0 so re-importing an exported zero does not report an edit.
    return Number(current ?? 0) === 0 && Number(incomingValue ?? 0) > 0;
  }
  return current === null || current === undefined || String(current).trim() === "";
}

function parseOptionalCount(
  raw: string | undefined,
  label: string,
): { value: number | null; error?: string } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { value: null };
  const parsed = numberFrom(trimmed);
  if (parsed === null) return { value: null, error: `Invalid ${label} "${trimmed}"` };
  if (parsed < 0) return { value: null, error: `${label} cannot be negative (${trimmed})` };
  if (!Number.isInteger(parsed)) {
    return { value: null, error: `${label} must be a whole number (${trimmed})` };
  }
  if (parsed > MAX_PG_INT) {
    return { value: null, error: `${label} exceeds maximum allowed (${MAX_PG_INT})` };
  }
  return { value: parsed };
}

function parseOptionalCost(raw: string | undefined): { value: number | null; error?: string } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { value: null };
  const parsed = numberFrom(trimmed);
  if (parsed === null) return { value: null, error: `Invalid unit cost "${trimmed}"` };
  if (parsed < 0) return { value: null, error: `Unit cost cannot be negative (${trimmed})` };
  if (parsed > MAX_UNIT_COST) {
    return { value: null, error: `Unit cost exceeds maximum allowed (${MAX_UNIT_COST})` };
  }
  return { value: Math.round(parsed * 100) / 100 };
}

export async function importInventoryWorkbook(
  buffer: ArrayBuffer,
  user: CurrentUser | null,
): Promise<ImportReport> {
  if (!buffer.byteLength) throw new Error("Choose a spreadsheet to import.");
  if (buffer.byteLength > MAX_INVENTORY_IMPORT_BYTES) {
    throw new Error("The workbook is too large (10 MB maximum).");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet =
    workbook.worksheets.find((w) => w.name.toLowerCase().includes("inventory")) ??
    workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");

  const { rows, warnings, error } = readSheet(sheet);
  if (error) throw new Error(error);

  return sql.begin(async (tx) => {
    const categories = await tx<{ id: number; name: string }[]>`
      SELECT id, name FROM categories ORDER BY id ASC`;
    const locations = await tx<{ id: number; name: string }[]>`
      SELECT id, name FROM locations ORDER BY id ASC`;

    const categoryByName = new Map<string, number>();
    for (const c of categories) {
      const key = normName(c.name);
      if (categoryByName.has(key)) {
        warnings.push(`Multiple categories match "${c.name}" ignoring case; using first match.`);
      } else {
        categoryByName.set(key, c.id);
      }
    }

    const locationByName = new Map<string, number>();
    for (const l of locations) {
      const key = normName(l.name);
      if (locationByName.has(key)) {
        warnings.push(`Multiple locations match "${l.name}" ignoring case; using first match.`);
      } else {
        locationByName.set(key, l.id);
      }
    }

    const report: ImportReport = {
      created: 0,
      enriched: 0,
      unchanged: 0,
      filled: {},
      skipped: [],
      unknownCategories: [],
      unknownLocations: [],
      warnings,
      sheet: sheet.name,
    };
    const noteUnknown = (list: string[], value: string) => {
      if (value && !list.includes(value)) list.push(value);
    };

    for (const { row, values } of rows) {
      const sku = normalizeSku(values.sku);
      const name = values.name?.trim() ?? "";

      if (!sku && !name) {
        report.skipped.push({ row, reason: "Row needs a SKU or item name" });
        continue;
      }

      const qtyRes = parseOptionalCount(values.quantity, "Quantity");
      if (qtyRes.error) {
        report.skipped.push({ row, reason: qtyRes.error });
        continue;
      }
      const minRes = parseOptionalCount(values.min_quantity, "Minimum level");
      if (minRes.error) {
        report.skipped.push({ row, reason: minRes.error });
        continue;
      }
      const costRes = parseOptionalCost(values.unit_cost);
      if (costRes.error) {
        report.skipped.push({ row, reason: costRes.error });
        continue;
      }

      const rawCondition = values.condition?.trim() ?? "";
      let parsedCondition: ReturnType<typeof parseConditionInput> = "IN_SERVICE";
      if (rawCondition) {
        parsedCondition = parseConditionInput(rawCondition);
        if (!parsedCondition) {
          report.skipped.push({ row, reason: `Unrecognised condition "${rawCondition}"` });
          continue;
        }
      }

      const categoryName = values.category?.trim() ?? "";
      const locationName = values.location?.trim() ?? "";
      const categoryId = categoryName ? (categoryByName.get(normName(categoryName)) ?? null) : null;
      const locationId = locationName ? (locationByName.get(normName(locationName)) ?? null) : null;
      if (categoryName && !categoryId) noteUnknown(report.unknownCategories, categoryName);
      if (locationName && !locationId) noteUnknown(report.unknownLocations, locationName);

      const incoming: Record<string, string | number | null> = {
        description: values.description?.trim() || null,
        supplier: values.supplier?.trim() || null,
        category_id: categoryId,
        location_id: locationId,
        unit_cost: costRes.value,
        min_quantity: minRes.value,
        condition_note: values.condition_note?.trim() || null,
      };

      type ExistingItemRow = {
        id: number;
        description: string | null;
        supplier: string | null;
        category_id: number | null;
        location_id: number | null;
        unit_cost: string | number;
        min_quantity: number;
        condition_note: string | null;
      };

      let existing: ExistingItemRow | undefined;
      if (sku) {
        const matches = await tx<ExistingItemRow[]>`
          SELECT id, description, supplier, category_id, location_id, unit_cost, min_quantity,
                 condition_note
            FROM items WHERE upper(sku) = ${sku} LIMIT 2 FOR UPDATE`;
        if (matches.length > 1) {
          report.skipped.push({
            row,
            reason: `Multiple items match SKU "${sku}"; resolve duplicate SKUs before importing`,
          });
          continue;
        }
        existing = matches[0];
      } else {
        const matches = await tx<ExistingItemRow[]>`
          SELECT id, description, supplier, category_id, location_id, unit_cost, min_quantity,
                 condition_note
            FROM items WHERE sku IS NULL AND lower(name) = ${name.toLowerCase()} LIMIT 2 FOR UPDATE`;
        if (matches.length > 1) {
          report.skipped.push({
            row,
            reason: `Multiple codeless items match "${name}"; add a SKU to update unambiguously`,
          });
          continue;
        }
        existing = matches[0];
      }

      if (!existing) {
        if (!name) {
          report.skipped.push({ row, reason: `New SKU ${sku} has no item name` });
          continue;
        }
        const quantity = qtyRes.value ?? 0;
        const [created] = await tx<{ id: number }[]>`
          INSERT INTO items (sku, name, description, category_id, location_id, unit, quantity,
                             min_quantity, unit_cost, supplier, condition, condition_note)
          VALUES (${sku}, ${name}, ${incoming.description}, ${categoryId}, ${locationId},
                  ${values.unit?.trim() || "unit"}, ${quantity},
                  ${minRes.value ?? 0}, ${costRes.value ?? 0},
                  ${incoming.supplier}, ${parsedCondition}, ${incoming.condition_note})
          RETURNING id`;

        if (quantity > 0 && !isRetiredCondition(parsedCondition)) {
          await tx`
            INSERT INTO movements (item_id, user_id, user_label, type, quantity, balance_after, note)
            VALUES (${created.id}, ${user?.userId ?? null}, ${user?.name ?? null}, 'IN',
                    ${quantity}, ${quantity}, 'Opening balance')`;
        }
        report.created++;
        continue;
      }

      const updates: Record<string, string | number | null> = {};
      for (const column of FILLABLE) {
        const value = incoming[column];
        if (value === null || value === "") continue;
        if (!isUnset(column, existing[column], value)) continue;
        updates[column] = value;
      }

      if (!Object.keys(updates).length) {
        report.unchanged++;
        continue;
      }

      const assignments = Object.keys(updates)
        .map((column, index) => `${column} = $${index + 1}`)
        .join(", ");
      await tx.unsafe(
        `UPDATE items SET ${assignments}, updated_at = now() WHERE id = $${
          Object.keys(updates).length + 1
        }`,
        [...Object.values(updates), existing.id],
      );
      for (const column of Object.keys(updates)) {
        report.filled[column] = (report.filled[column] ?? 0) + 1;
      }
      report.enriched++;
    }

    // One entry rather than one per row: an import is a single act, and a
    // hundred near-identical lines would drown the trail it is meant to serve.
    await recordAudit(
      {
        user,
        action: "IMPORT",
        entity: "item",
        details:
          `Spreadsheet import from sheet "${sheet.name}": ${report.created} created, ` +
          `${report.enriched} enriched, ${report.unchanged} already complete, ` +
          `${report.skipped.length} skipped`,
      },
      tx,
    );

    return report;
  });
}
