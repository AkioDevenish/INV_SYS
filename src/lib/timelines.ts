/**
 * Timelines: the targets-and-timelines tracker the delegation keeps.
 *
 * The source workbook holds three differently shaped sheets - dated technical
 * activities, recurring administrative tasks, and a person's own task list -
 * so one row type carries all three and leaves the fields a given sheet does
 * not use empty.
 */

export const TASK_STATUSES = ["NOT_STARTED", "ONGOING", "DELAYED", "COMPLETE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_META: Record<TaskStatus, { label: string; chip: string; short: string }> = {
  NOT_STARTED: {
    label: "Not started",
    short: "NS",
    chip: "border-ink/20 bg-ink/8 text-ink/65",
  },
  ONGOING: {
    label: "Ongoing",
    short: "O",
    chip: "border-iica-500/30 bg-iica-600/10 text-iica-700",
  },
  DELAYED: {
    label: "Delayed",
    short: "D",
    chip: "border-rose-500/45 bg-rose-500/15 text-rose-700",
  },
  COMPLETE: {
    label: "Complete",
    short: "C",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export const PRIORITIES = ["H", "M", "L"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * High is a solid danger red rather than a tint: it is the one priority that
 * should be impossible to skim past, and the pale version read as decoration.
 * Medium and low step down from there so the three are told apart by weight,
 * not only by hue.
 */
export const PRIORITY_META: Record<Priority, { label: string; chip: string }> = {
  H: { label: "High", chip: "border-rose-600 bg-rose-600 font-semibold text-white" },
  M: { label: "Medium", chip: "border-gold-500/45 bg-gold-400/25 text-gold-700" },
  L: { label: "Low", chip: "border-ink/20 bg-ink/[0.07] text-ink/60" },
};

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

/**
 * Areas come from the workbook's sheet names, so a new sheet needs no code
 * change. These are the ones we know, and anything else shows as its own name.
 */
const AREA_LABELS: Record<string, string> = {
  TC: "Technical cooperation",
  ADMIN: "Administration",
};

export function areaLabel(area: string): string {
  return AREA_LABELS[area.toUpperCase()] ?? area;
}

/** Strict YYYY-MM-DD calendar validation (rejects impossible dates like Feb 30). */
export function isValidIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Keeps task status and numeric progress mutually consistent:
 * - COMPLETE always implies 100%
 * - 100% always implies COMPLETE
 * - NOT_STARTED resets any tracked percentage to 0% (or keeps null if untracked)
 */
export function syncStatusAndProgress(
  status: TaskStatus,
  progress: number | null,
): { status: TaskStatus; progress: number | null } {
  if (status === "COMPLETE") {
    return { status: "COMPLETE", progress: 100 };
  }
  if (progress !== null && progress >= 100) {
    return { status: "COMPLETE", progress: 100 };
  }
  if (status === "NOT_STARTED") {
    return { status: "NOT_STARTED", progress: progress === null ? null : 0 };
  }
  return { status, progress };
}
