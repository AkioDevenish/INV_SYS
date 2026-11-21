/**
 * The physical condition of an item, which is deliberately separate from its
 * stock level. "In stock" answers how many there are; this answers whether they
 * are still fit for use. A single chair can be in stock and due for disposal at
 * the same time.
 *
 * The list is fixed rather than user-editable because each value carries
 * behaviour - what colour it shows, whether it counts as a problem, whether the
 * item is still in service. A free-text list could not drive any of that.
 */
export const CONDITIONS = [
  "IN_SERVICE",
  "NEEDS_REPAIR",
  "FOR_DECOMMISSION",
  "DECOMMISSIONED",
  "DISPOSED",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export type ConditionMeta = {
  label: string;
  description: string;
  /** Shown in lists and on the item record. */
  chip: string;
  /** True when the item is no longer in normal use. */
  retired: boolean;
  /** True when somebody needs to act on it. */
  flagged: boolean;
};

export const CONDITION_META: Record<Condition, ConditionMeta> = {
  IN_SERVICE: {
    label: "In service",
    description: "Working and in normal use.",
    chip: "border-emerald-600/40 bg-emerald-100 text-emerald-800",
    retired: false,
    flagged: false,
  },
  NEEDS_REPAIR: {
    label: "Needs repair",
    description: "Faulty or damaged, but worth repairing.",
    chip: "border-gold-600/45 bg-gold-400/25 text-gold-700",
    retired: false,
    flagged: true,
  },
  FOR_DECOMMISSION: {
    label: "For decommissioning",
    description: "Marked to be taken out of service, not yet removed.",
    chip: "border-orange-600/40 bg-orange-100 text-orange-800",
    retired: false,
    flagged: true,
  },
  DECOMMISSIONED: {
    label: "Decommissioned",
    description: "Taken out of service and awaiting disposal.",
    chip: "border-ink/25 bg-ink/10 text-ink/70",
    retired: true,
    flagged: true,
  },
  DISPOSED: {
    label: "Disposed",
    description: "Written off and gone. Kept for the record only.",
    chip: "border-rose-600/40 bg-rose-100 text-rose-700",
    retired: true,
    flagged: false,
  },
};

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/**
 * Accepts raw enum values ("NEEDS_REPAIR"), case/space variants ("needs repair"),
 * or UI labels ("For decommissioning") and returns the canonical Condition or null.
 */
export function parseConditionInput(value: unknown): Condition | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (isCondition(upper)) return upper;

  const lower = trimmed.toLowerCase().replace(/\s+/g, " ");
  for (const condition of CONDITIONS) {
    if (CONDITION_META[condition].label.toLowerCase() === lower) {
      return condition;
    }
  }
  if (lower === "for decommission") return "FOR_DECOMMISSION";
  return null;
}

/** Everything a person would want to chase up. */
export const FLAGGED_CONDITIONS = CONDITIONS.filter((c) => CONDITION_META[c].flagged);

/** Conditions whose assets are out of service / written off and cannot move stock. */
export const RETIRED_CONDITIONS = CONDITIONS.filter((c) => CONDITION_META[c].retired);

export function isRetiredCondition(value: unknown): boolean {
  return isCondition(value) && CONDITION_META[value].retired;
}

/** Storage location names that drive Inventory tabs and stock status rules. */
export const FILLING_ROOM_LOCATION_NAME = "Filling Room";
export const CABI_LOCATION_NAME = "CABI";
export const FILLING_CABINET_LOCATION_NAMES = [
  "Shelf Top",
  "Second Shelf",
  "Third Shelf",
  "Fourth Shelf",
  "Fifth Shelf",
  "Bottom Shelf",
] as const;

export const SYSTEM_LOCATION_NAMES: readonly string[] = [
  FILLING_ROOM_LOCATION_NAME,
  CABI_LOCATION_NAME,
  ...FILLING_CABINET_LOCATION_NAMES,
];

const SYSTEM_LOCATION_LOWER = new Set(SYSTEM_LOCATION_NAMES.map((n) => n.toLowerCase()));
const FILLING_CABINET_LOWER = new Set(FILLING_CABINET_LOCATION_NAMES.map((n) => n.toLowerCase()));

export const SYSTEM_CATEGORY_NAMES: readonly string[] = ["IT equipment"];
const SYSTEM_CATEGORY_LOWER = new Set(SYSTEM_CATEGORY_NAMES.map((n) => n.toLowerCase()));

export function isSystemLocationName(name: string | null | undefined): boolean {
  return !!name && SYSTEM_LOCATION_LOWER.has(name.trim().toLowerCase());
}

export function isSystemCategoryName(name: string | null | undefined): boolean {
  return !!name && SYSTEM_CATEGORY_LOWER.has(name.trim().toLowerCase());
}

/** True when a location holds pooled stock rather than an individual office assignment. */
export function isStockStorageLocation(locationName: string | null | undefined): boolean {
  if (!locationName) return false;
  const lower = locationName.trim().toLowerCase();
  return lower === FILLING_ROOM_LOCATION_NAME.toLowerCase() || FILLING_CABINET_LOWER.has(lower);
}

/**
 * True when an active in-service item is deployed outside stock storage AND is
 * above its reorder threshold. Items at or below minimum (or at zero) surface
 * their Low/Out of stock alert so lists match Dashboard reorder alerts.
 */
export function isAssignedAsset(item: {
  location_name: string | null | undefined;
  quantity: number;
  min_quantity: number;
  condition?: Condition;
}): boolean {
  if (item.condition && item.condition !== "IN_SERVICE") return false;
  if (!item.location_name || isStockStorageLocation(item.location_name)) return false;
  if (item.quantity <= 0 || item.quantity <= item.min_quantity) return false;
  return true;
}
