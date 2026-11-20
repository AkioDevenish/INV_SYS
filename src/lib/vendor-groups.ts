export type VendorGroupKey =
  | "CATERING"
  | "PRINTING"
  | "IT"
  | "HOTELS"
  | "FACILITIES"
  | "UTILITIES";

export type VendorGroupMeta = {
  key: VendorGroupKey;
  label: string;
  shortLabel: string;
  categories: string[];
  tint: string;
  border: string;
  text: string;
  badgeClass: string;
};

export const VENDOR_GROUPS: Record<VendorGroupKey, VendorGroupMeta> = {
  CATERING: {
    key: "CATERING",
    label: "Catering & Supplies",
    shortLabel: "Catering",
    categories: ["Caterers", "Groceries"],
    tint: "#fef0c3",
    border: "#f5cc6a",
    text: "#784a0e",
    badgeClass: "bg-[#fef0c3] text-[#784a0e] border-[#f5cc6a]",
  },
  PRINTING: {
    key: "PRINTING",
    label: "Printing & Stationery",
    shortLabel: "Printing & Stationery",
    categories: ["Printing", "Stationery"],
    tint: "#e0edff",
    border: "#a3c6fa",
    text: "#19417d",
    badgeClass: "bg-[#e0edff] text-[#19417d] border-[#a3c6fa]",
  },
  IT: {
    key: "IT",
    label: "IT & Media",
    shortLabel: "IT & Media",
    categories: ["IT", "Photography"],
    tint: "#ede7fb",
    border: "#c4b2f0",
    text: "#482d82",
    badgeClass: "bg-[#ede7fb] text-[#482d82] border-[#c4b2f0]",
  },
  HOTELS: {
    key: "HOTELS",
    label: "Hotels, Travel & Courier",
    shortLabel: "Hotels & Travel",
    categories: ["Hotels", "Transportation", "Travel Agency", "Courier Services"],
    tint: "#daf2e6",
    border: "#8fd4b2",
    text: "#155236",
    badgeClass: "bg-[#daf2e6] text-[#155236] border-[#8fd4b2]",
  },
  FACILITIES: {
    key: "FACILITIES",
    label: "Facilities & Vehicles",
    shortLabel: "Facilities & Vehicles",
    categories: ["Facilities Mgmt", "Office Vehicle"],
    tint: "#fde2e4",
    border: "#f4a6ad",
    text: "#881d2a",
    badgeClass: "bg-[#fde2e4] text-[#881d2a] border-[#f4a6ad]",
  },
  UTILITIES: {
    key: "UTILITIES",
    label: "Utilities & Other",
    shortLabel: "Utilities",
    categories: ["Utilities", "Other"],
    tint: "#ebedf2",
    border: "#c5cbd6",
    text: "#374151",
    badgeClass: "bg-[#ebedf2] text-[#374151] border-[#c5cbd6]",
  },
};

export const VENDOR_GROUP_ORDER: VendorGroupKey[] = [
  "CATERING",
  "PRINTING",
  "IT",
  "HOTELS",
  "FACILITIES",
  "UTILITIES",
];

export const VENDOR_CATEGORIES = [
  "Caterers",
  "Printing",
  "IT",
  "Hotels",
  "Facilities Mgmt",
  "Office Vehicle",
  "Utilities",
  "Stationery",
  "Photography",
  "Groceries",
  "Courier Services",
  "Transportation",
  "Travel Agency",
  "Other",
] as const;

const EXACT_CATEGORY_GROUP = new Map<string, VendorGroupKey>(
  (Object.keys(VENDOR_GROUPS) as VendorGroupKey[]).flatMap((key) =>
    VENDOR_GROUPS[key].categories.map((cat) => [cat.trim().toLowerCase(), key] as const),
  ),
);

/**
 * Resolves a vendor's category to its display group.
 * Exact declared category matches always win; fallback heuristics check travel
 * before word-bounded AV/IT patterns so "Travel Agency" never matches "av".
 */
export function vendorGroupForCategory(category: string | null | undefined): VendorGroupKey {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return "UTILITIES";

  const exact = EXACT_CATEGORY_GROUP.get(c);
  if (exact) return exact;

  if (c.includes("cater") || c.includes("grocer") || c.includes("pantry") || /\bbak(e|er|ery|ing)?\b/.test(c)) {
    return "CATERING";
  }
  if (c.includes("print") || c.includes("stationery") || c.includes("stationary")) {
    return "PRINTING";
  }
  if (
    c.includes("hotel") ||
    c.includes("transport") ||
    c.includes("travel") ||
    c.includes("courier")
  ) {
    return "HOTELS";
  }
  if (
    /\bit\b/.test(c) ||
    c.includes("photo") ||
    /\bav\b/.test(c) ||
    c.includes("media") ||
    c.includes("audio visual") ||
    c.includes("audio-visual")
  ) {
    return "IT";
  }
  if (
    c.includes("facilit") ||
    c.includes("vehicle") ||
    /\bauto\b/.test(c) ||
    c.includes("automotive") ||
    c.includes("maint")
  ) {
    return "FACILITIES";
  }
  return "UTILITIES";
}

export const VENDOR_STATUS_META: Record<
  string,
  { label: string; chipClass: string }
> = {
  PREFERRED: {
    label: "Preferred",
    chipClass: "bg-iica-700 text-white border-iica-700",
  },
  APPROVED: {
    label: "Approved",
    chipClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  ON_HOLD: {
    label: "On hold",
    chipClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
  INACTIVE: {
    label: "Inactive",
    chipClass: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

export const CONTRACT_STATUS_META: Record<
  string,
  { label: string; chipClass: string }
> = {
  NONE: {
    label: "As needed",
    chipClass: "bg-slate-50 text-slate-600 border-slate-200",
  },
  ACTIVE_CONTRACT: {
    label: "Active contract",
    chipClass: "bg-blue-50 text-blue-800 border-blue-200",
  },
  RECURRING_UTILITY: {
    label: "Recurring utility",
    chipClass: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
  RENEWAL_DUE: {
    label: "Renewal due",
    chipClass: "bg-rose-50 text-rose-800 border-rose-200",
  },
};

export const BILLING_CYCLE_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  ON_DEMAND: "On demand",
};

export const ENGAGEMENT_KIND_LABELS: Record<string, string> = {
  QUOTE: "Quote",
  PO: "Purchase order",
  INVOICE: "Invoice",
  UTILITY_BILL: "Utility bill",
  SERVICE: "Maintenance / service",
};

export const ENGAGEMENT_STATUS_META: Record<
  string,
  { label: string; chipClass: string }
> = {
  QUOTED: {
    label: "Quoted",
    chipClass: "bg-slate-100 text-slate-700 border-slate-200",
  },
  APPROVED: {
    label: "Approved",
    chipClass: "bg-blue-50 text-blue-800 border-blue-200",
  },
  PENDING_PAYMENT: {
    label: "Pending payment",
    chipClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
  PAID: {
    label: "Paid",
    chipClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
};

export function formatTtd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat("en-TT", {
    style: "currency",
    currency: "TTD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Returns today's YYYY-MM-DD key in Trinidad & Tobago time (UTC-4, no DST). */
export function trinidadTodayKey(): string {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Validates and normalizes an optional external website URL to http/https.
 * Returns null if blank, or `{ error }` when the scheme is unsafe or invalid.
 */
export function parseSafeHttpUrl(raw: string | null | undefined): {
  url: string | null;
  error?: string;
} {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { url: null };
  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: null, error: "Website URL must use http:// or https://." };
    }
    return { url: parsed.toString() };
  } catch {
    return { url: null, error: "Enter a valid website URL (e.g. https://example.com)." };
  }
}

/**
 * Sanitizes a raw phone string into a safe `tel:` href by taking the primary
 * number (splitting on `/` or extensions like `ext` / `x`) and stripping
 * non-dialable characters. Returns null if no dialable digits remain.
 */
export function sanitizeTelHref(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const primary = trimmed.split(/\s*(?:\/|;|,|\||\b(?:ext\.?|extension)\b|\bx(?=\s*\d))/i)[0]?.trim() ?? "";
  if (!primary) return null;
  const hasLeadingPlus = primary.startsWith("+");
  const digits = primary.replace(/\D+/g, "");
  if (digits.length < 3) return null;
  return `tel:${hasLeadingPlus ? "+" : ""}${digits}`;
}

/**
 * Advances a YYYY-MM-DD date by one billing cycle (clamping month-end days).
 */
export function suggestNextDueDate(
  baseDate: string | null | undefined,
  cycle: string | null | undefined,
): string | null {
  if (!baseDate || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) return null;
  const monthsToAdd =
    cycle === "MONTHLY" ? 1 : cycle === "QUARTERLY" ? 3 : cycle === "ANNUAL" ? 12 : 0;
  if (monthsToAdd === 0) return null;
  const [y, m, d] = baseDate.split("-").map(Number);
  const targetMonthIndex = (y * 12 + (m - 1)) + monthsToAdd;
  const ny = Math.floor(targetMonthIndex / 12);
  const nm = (targetMonthIndex % 12) + 1;
  const maxDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, maxDay);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
