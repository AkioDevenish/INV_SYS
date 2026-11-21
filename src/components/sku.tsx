import { displaySku, isPlaceholderSku } from "@/lib/sku";

/**
 * Renders an asset code, or "Unknown" when the stored value is a placeholder.
 * The real value stays in the title attribute so anyone tracing a record can
 * still find it without digging through the database.
 */
export function Sku({ sku, className = "" }: { sku: string | null | undefined; className?: string }) {
  const placeholder = isPlaceholderSku(sku) || !sku;
  const hasExplicitColor = /\btext-/.test(className);
  const placeholderStyle = hasExplicitColor ? "italic" : "italic text-ink/60";
  return (
    <span
      className={`${placeholder ? placeholderStyle : "font-mono"} ${className}`}
      title={placeholder && sku ? `No asset code recorded (internal reference ${sku})` : undefined}
    >
      {displaySku(sku)}
    </span>
  );
}
