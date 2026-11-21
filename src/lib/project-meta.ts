/**
 * Project constants that both server and client code need. Nothing here
 * touches the database, so client components can import it freely.
 */

export const ACTION_STATES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export const ACTION_STATE_META: Record<ActionState, { label: string; chip: string }> = {
  OPEN: { label: "Open", chip: "border-ink/20 bg-ink/8 text-ink/70" },
  IN_PROGRESS: { label: "In progress", chip: "border-iica-500/30 bg-iica-600/10 text-iica-700" },
  DONE: { label: "Done", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" },
  CANCELLED: { label: "Cancelled", chip: "border-ink/15 bg-ink/[0.04] text-ink/45 line-through" },
};

export function isActionState(v: string): v is ActionState {
  return (ACTION_STATES as readonly string[]).includes(v);
}

export const APPROVAL_STATES = ["DRAFT", "FINAL"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export function isApprovalState(v: string): v is ApprovalState {
  return (APPROVAL_STATES as readonly string[]).includes(v);
}

export const APPROVAL_META: Record<ApprovalState, { label: string; chip: string }> = {
  DRAFT: { label: "Draft", chip: "border-gold-500/40 bg-gold-400/20 text-gold-700" },
  FINAL: { label: "Approved final", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" },
};

export const RESOURCE_TYPES = [
  "Concept note",
  "Proposal",
  "Agreement",
  "Report",
  "Presentation",
  "Training material",
  "Budget",
  "Photo or media",
  "Other",
];

export const INVOLVEMENT_ROLES = [
  "Funder",
  "Implementing partner",
  "Government counterpart",
  "Beneficiary",
  "Technical advisor",
  "Participant",
  "Other",
];

/** Common in the delegation's work; any three-letter ISO code is accepted. */
export const CURRENCIES = ["TTD", "USD", "EUR", "GBP", "CAD", "XCD", "JMD", "BBD"];

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-";
  const code = (currency ?? "").trim().toUpperCase();
  const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  return code ? `${code} ${n}` : n;
}

/** Reference lists a manager can edit from Projects → Reference lists. */
export const REFERENCE_KINDS = [
  "status",
  "phase",
  "fundingStatus",
  "role",
  "programmeArea",
  "tag",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export function isReferenceKind(v: string): v is ReferenceKind {
  return (REFERENCE_KINDS as readonly string[]).includes(v);
}

export const REFERENCE_META: Record<
  ReferenceKind,
  { label: string; noun: string; description: string; fixedCount?: boolean }
> = {
  status: {
    label: "Project statuses",
    noun: "status",
    description: "Where a project stands operationally. Separate from its model phase (BR-02, BR-03).",
  },
  phase: {
    label: "IICA model phases",
    noun: "phase",
    description: "The eight steps of IICA's technical cooperation model. They can be renamed but not added or removed.",
    fixedCount: true,
  },
  fundingStatus: {
    label: "Funding statuses",
    noun: "funding status",
    description: "Used for each funder arrangement and for a project's overall funding position (BR-11).",
  },
  role: {
    label: "Project roles",
    noun: "role",
    description: "Responsibilities a staff member can hold on a project, separate from job title (BR-06).",
  },
  programmeArea: {
    label: "Programme areas",
    noun: "programme area",
    description: "IICA technical cooperation areas used to classify projects (BR-04).",
  },
  tag: {
    label: "Tags",
    noun: "tag",
    description: "Search labels for finding similar projects. Group them with a category if useful.",
  },
};

/** Status colours step through the list order; closed statuses go grey or green. */
const STATUS_TONES = [
  "border-violet-200 bg-violet-50 text-violet-800",
  "border-sky-200 bg-sky-50 text-sky-800",
  "border-iica-500/30 bg-iica-600/10 text-iica-800",
  "border-gold-500/40 bg-gold-400/20 text-gold-700",
  "border-teal-200 bg-teal-50 text-teal-800",
];

export function statusTone(position: number, isClosed: boolean, name: string): string {
  if (isClosed) {
    return /cancel/i.test(name)
      ? "border-ink/15 bg-ink/[0.05] text-ink/55"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  }
  if (/hold|pause|suspend/i.test(name)) return "border-rose-200 bg-rose-50 text-rose-800";
  return STATUS_TONES[Math.max(0, position - 1) % STATUS_TONES.length];
}

export function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatDay(key: string | null | undefined, withYear = true): string {
  if (!key || !isIsoDate(key.slice(0, 10))) return "-";
  return new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** Trinidad has no daylight saving, so AST is always UTC-4. */
export function astTodayKey(): string {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}
