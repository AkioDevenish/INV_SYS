/**
 * Some items came in without a real asset code, so the import minted a
 * placeholder from the item's name to satisfy the unique key. Those codes
 * identify nothing to a reader, so screens show "Unknown" instead.
 *
 * The stored value is deliberately left alone: it is the primary handle for
 * the row, exports carry it, and the spreadsheet importer matches on it. Only
 * the display changes.
 */
const PLACEHOLDER = /^INV-UNKNOWN(?:-|$)/i;

export function isPlaceholderSku(sku: string | null | undefined): boolean {
  return !!sku && PLACEHOLDER.test(sku);
}

export function displaySku(sku: string | null | undefined): string {
  if (!sku) return "Unknown";
  return isPlaceholderSku(sku) ? "Unknown" : sku;
}

/**
 * Normalizes user-supplied asset codes to uppercase and collapses blanks to
 * NULL so unique indexing (`upper(sku)`) stays consistent across forms and imports.
 */
export function normalizeSku(sku: string | null | undefined): string | null {
  const trimmed = sku?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}
