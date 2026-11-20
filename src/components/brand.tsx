import { ORG_NAME } from "@/lib/brand";

/**
 * Every appearance of the IICA-TT identity comes through here, and the artwork
 * itself lives in `public/iica-logo.png` (wide lockup) and `public/iica-mark.png`
 * (square seal). Swapping in higher-resolution or vector files from the
 * communications team is a file replacement - no code changes.
 */

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/iica-mark.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0"
    />
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <BrandMark size={32} />;
  }

  return (
    <div className="min-w-0">
      {/* Intrinsic size is 300×161. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/iica-logo.png"
        alt="IICA"
        width={300}
        height={161}
        className="h-9 w-auto"
      />
      <div className="mt-1.5 text-xs font-medium text-ink/65">
        {ORG_NAME}
      </div>
    </div>
  );
}
