import { ArrowDownLeft, ArrowUpRight, SlidersHorizontal } from "lucide-react";

const CONFIG = {
  IN: {
    label: "Received",
    icon: ArrowDownLeft,
    className: "border-iica-500/30 bg-iica-600/10 text-iica-700",
  },
  OUT: {
    label: "Issued",
    icon: ArrowUpRight,
    className: "border-gold-500/40 bg-gold-400/15 text-gold-700",
  },
  ADJUST: {
    label: "Adjusted",
    icon: SlidersHorizontal,
    className: "border-sky-600/35 bg-sky-100 text-sky-800",
  },
} as const;

export type MovementType = keyof typeof CONFIG;

export function MovementTypeBadge({
  type,
  withLabel = false,
}: {
  type: MovementType;
  withLabel?: boolean;
}) {
  const config = CONFIG[type] ?? CONFIG.ADJUST;
  const Icon = config.icon;

  if (withLabel) {
    return (
      <span className={`chip ${config.className}`}>
        <Icon size={12} aria-hidden="true" /> {config.label}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={config.label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${config.className}`}
      title={config.label}
    >
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}

export function movementLabel(type: MovementType) {
  return (CONFIG[type] ?? CONFIG.ADJUST).label;
}
