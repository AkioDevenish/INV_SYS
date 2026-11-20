import Link from "next/link";
import type { ReactNode } from "react";
import { CONDITION_META, type Condition } from "@/lib/conditions";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="animate-rise mb-4 flex flex-col gap-3 sm:mb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold text-iica-700">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[1.35rem] font-semibold tracking-tight text-ink sm:text-[1.6rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/65">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A single KPI figure. Subtle tonal borders and icon pills carry urgency
 * without harsh clipped edge stripes.
 */
const STAT_TONES = {
  default: {
    card: "",
    icon: "bg-ink/[0.04] text-ink/65 ring-ink/8",
    value: "text-ink",
  },
  good: {
    card: "",
    icon: "bg-iica-50 text-iica-700 ring-iica-600/15",
    value: "text-iica-800",
  },
  positive: {
    card: "",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    value: "text-emerald-800",
  },
  warn: {
    card: "border-gold-400/50 bg-gold-400/[0.04]",
    icon: "bg-gold-400/20 text-gold-700 ring-gold-600/20",
    value: "text-gold-700",
  },
  danger: {
    card: "border-rose-300/80 bg-rose-50/35",
    icon: "bg-rose-100 text-rose-700 ring-rose-600/20",
    value: "text-rose-700",
  },
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: keyof typeof STAT_TONES;
  href?: string;
}) {
  const styles = STAT_TONES[tone];

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink/65">
          {label}
        </div>
        {icon && (
          <span
            aria-hidden="true"
            className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 sm:flex ${styles.icon}`}
          >
            {icon}
          </span>
        )}
      </div>

      {/* tabular-nums keeps the figures aligned across the row. */}
      <div
        className={`mt-1.5 break-words text-[1.45rem] font-semibold leading-none tracking-tight tabular-nums ${styles.value}`}
      >
        {value}
      </div>

      {hint && (
        <div className="mt-1.5 truncate text-[11px] leading-snug text-ink/65">
          {hint}
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`panel block min-w-0 p-3.5 transition hover:border-iica-300 hover:bg-iica-50/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600 sm:p-4 ${styles.card}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={`panel min-w-0 p-3.5 sm:p-4 ${styles.card}`}>
      {inner}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  bodyClassName = "",
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink/8 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs leading-snug text-ink/65">{description}</p>
          )}
        </div>
        {/* Narrow dashboard columns were wrapping "View all" onto two lines. */}
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-ink/10 bg-ink/[0.03] text-ink/65"
        >
          {icon}
        </div>
      )}
      <div className="text-sm font-semibold text-ink/85">{title}</div>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink/65">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * The row's single status reading. A condition other than in-service replaces
 * the stock level rather than sitting next to it, because they are answers to
 * the same question and only one of them is the useful one: a disposed item
 * reading "Out of stock" is technically true and entirely beside the point.
 */
export function StockPill({
  quantity,
  min,
  assigned = false,
  condition,
}: {
  quantity: number;
  min: number;
  assigned?: boolean;
  condition?: Condition;
}) {
  if (condition && condition !== "IN_SERVICE") {
    const meta = CONDITION_META[condition];
    if (meta) {
      return (
        <span className={`chip ${meta.chip}`} title={meta.description}>
          {meta.label}
        </span>
      );
    }
  }
  if (Boolean(assigned)) {
    return <span className="chip border-iica-500/30 bg-iica-600/10 text-iica-700">Assigned</span>;
  }
  if (quantity <= 0) {
    return <span className="chip border-rose-500/35 bg-rose-500/10 text-rose-700">Out of stock</span>;
  }
  if (quantity <= min) {
    return <span className="chip border-gold-500/40 bg-gold-400/15 text-gold-700">Low stock</span>;
  }
  return <span className="chip border-iica-500/30 bg-iica-600/10 text-iica-700">In stock</span>;
}
