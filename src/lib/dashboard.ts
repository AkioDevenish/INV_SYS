/**
 * The dashboard is a list of panels, not a fixed layout. Each one declares how
 * wide it wants to be and what permission it needs; the order and visibility
 * come from the person's own saved arrangement.
 *
 * Shared by server and client, so no "server-only" here.
 */
export type DashboardFocus = "all" | "inventory" | "operations" | "directory";

export const PANELS = {
  stats: { title: "Key figures", span: 12, focus: "all" as const },
  myWeek: { title: "My week", span: 6, focus: "operations" as const },
  projectRisk: { title: "Projects needing attention", span: 6, focus: "operations" as const },
  projectFunding: { title: "Project funding", span: 6, focus: "operations" as const },
  chart: { title: "Movement volume", span: 8, focus: "inventory" as const },
  category: { title: "Stock by category", span: 4, focus: "inventory" as const },
  agenda: { title: "Upcoming schedule", span: 6, focus: "operations" as const },
  operations: { title: "Timelines & projects", span: 6, focus: "operations" as const },
  health: { title: "Catalogue health", span: 4, focus: "inventory" as const },
  location: { title: "Stock by location", span: 4, focus: "inventory" as const },
  attention: { title: "Needs attention", span: 4, focus: "inventory" as const },
  directory: { title: "Directory by group", span: 6, focus: "directory" as const },
  vendors: { title: "Vendors & renewals", span: 6, focus: "directory" as const },
  movements: { title: "Latest movements", span: 6, focus: "inventory" as const },
  topValue: { title: "Top stock items", span: 6, focus: "inventory" as const },
  admin: { title: "Accounts & reference lists", span: 12, focus: "all" as const },
} as const;

export type PanelId = keyof typeof PANELS;

/** The arrangement everyone starts from. */
export const DEFAULT_ORDER: PanelId[] = [
  "stats",
  "myWeek",
  "projectRisk",
  "chart",
  "category",
  "agenda",
  "operations",
  "projectFunding",
  "health",
  "location",
  "attention",
  "directory",
  "vendors",
  "movements",
  "topValue",
  "admin",
];

export type DashboardLayout = {
  order: PanelId[];
  hidden: PanelId[];
};

export const DEFAULT_LAYOUT: DashboardLayout = { order: DEFAULT_ORDER, hidden: [] };

function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && value in PANELS;
}

/**
 * Reads a stored layout back into something safe to render.
 *
 * Anything unrecognised is dropped and anything missing is appended, so a panel
 * added in a later release still shows up for people who saved a layout before
 * it existed - rather than silently never appearing.
 */
export function parseLayout(raw: string | null | undefined): DashboardLayout {
  if (!raw) return DEFAULT_LAYOUT;

  try {
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const rawOrder = Array.isArray(parsed.order) ? parsed.order.filter(isPanelId) : [];
    const rawHidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(isPanelId) : [];

    const order: PanelId[] = [];
    const seen = new Set<PanelId>();
    for (const id of rawOrder) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    for (const id of DEFAULT_ORDER) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }

    const hidden = [...new Set(rawHidden)];
    return { order, hidden };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Tailwind needs whole class names, so the spans are spelled out. */
export const SPAN_CLASS: Record<number, string> = {
  4: "lg:col-span-6 xl:col-span-4",
  5: "lg:col-span-12 xl:col-span-5",
  6: "lg:col-span-6 xl:col-span-6",
  7: "lg:col-span-12 xl:col-span-7",
  8: "lg:col-span-12 xl:col-span-8",
  12: "col-span-1 lg:col-span-12",
};
