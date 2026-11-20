import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { Role } from "./roles";
import {
  CABI_LOCATION_NAME,
  FILLING_CABINET_LOCATION_NAMES,
  FILLING_ROOM_LOCATION_NAME,
  FLAGGED_CONDITIONS,
  RETIRED_CONDITIONS,
  SYSTEM_LOCATION_NAMES,
  isCondition,
  type Condition,
} from "./conditions";
import { APP_TIMEZONE } from "./format";

export {
  CABI_LOCATION_NAME,
  FILLING_CABINET_LOCATION_NAMES,
  FILLING_ROOM_LOCATION_NAME,
  SYSTEM_LOCATION_NAMES,
};

const MAX_PG_INT = 2_147_483_647;

function isValidPgInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PG_INT;
}

/** Escapes `%`, `_`, and `\` so user search input is matched literally by `ILIKE`. */
function escapeIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, "\\$&");
}

export type ItemRow = {
  id: number;
  sku: string | null;
  name: string;
  description: string | null;
  category_id: number | null;
  location_id: number | null;
  category_name: string | null;
  location_name: string | null;
  unit: string;
  quantity: number;
  min_quantity: number;
  unit_cost: number;
  supplier: string | null;
  condition: Condition;
  condition_note: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MovementRow = {
  id: number;
  item_id: number;
  item_name: string;
  item_sku: string | null;
  user_name: string | null;
  type: "IN" | "OUT" | "ADJUST";
  quantity: number;
  balance_after: number;
  note: string | null;
  created_at: Date;
};

export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  must_change_password: boolean;
  created_at: Date;
  last_login_at: Date | null;
};

export type StakeholderRow = {
  id: number;
  name: string;
  organisation: string | null;
  job_title: string | null;
  email: string | null;
  alt_email: string | null;
  phone: string | null;
  alt_phone: string | null;
  location: string | null;
  gender: string | null;
  age_group: string | null;
  website: string | null;
  social: string | null;
  notes: string | null;
  group_id: number | null;
  group_name: string | null;
  created_at: Date;
  updated_at: Date;
};

export type TaxonomyRow = {
  id: number;
  name: string;
  description: string | null;
  created_at: Date;
  item_count: number;
};

export type CalendarEventRow = {
  id: number;
  title: string;
  description: string | null;
  event_type: "MEETING" | "MISSION" | "LEAVE" | "DEADLINE" | "HOLIDAY" | "OTHER";
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  location: string | null;
  organiser_id: number | null;
  organiser_name: string | null;
  source: string;
  updated_at: Date;
};
export type VendorRow = { id: number; category: string; service: string | null; name: string; phone: string | null; contact_person: string | null; email: string | null; notes: string | null; updated_at: Date };

/**
 * `unit_cost` is NUMERIC in the database, which the driver hands back as a
 * string; every read casts it to float8 so the app always sees a number.
 */
const ITEM_SELECT = `
  SELECT i.id, i.sku, i.name, i.description, i.category_id, i.location_id,
         i.unit, i.quantity, i.min_quantity, i.unit_cost::float8 AS unit_cost,
         i.supplier, i.condition, i.condition_note, i.created_at, i.updated_at,
         c.name AS category_name, l.name AS location_name
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN locations  l ON l.id = i.location_id
`;

export type ItemFilters = {
  search?: string;
  categoryId?: number;
  locationId?: number;
  stock?: "all" | "low" | "out" | "attention";
  /** A single condition, "flagged" for items needing action, or "retired" for decommissioned/disposed. */
  condition?: string;
  /** Excludes decommissioned & disposed items (used by active top-stock / valuation lists). */
  excludeRetired?: boolean;
  locationGroup?: "iica" | "cabi" | "filling-cabinet";
  page?: number;
  perPage?: number;
  sort?: "name" | "quantity" | "units" | "value" | "updated";
};

const FILLING_CABINET_LOWER = FILLING_CABINET_LOCATION_NAMES.map((n) => n.toLowerCase());
const CABI_LOWER = CABI_LOCATION_NAME.toLowerCase();

function itemWhere(filters: ItemFilters): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    const n = params.length;
    where.push(
      `(i.name ILIKE $${n + 1} OR i.sku ILIKE $${n + 1} OR i.supplier ILIKE $${n + 1} OR i.description ILIKE $${n + 1})`,
    );
    params.push(`%${escapeIlike(filters.search)}%`);
  }
  if (filters.categoryId !== undefined) {
    if (isValidPgInt(filters.categoryId)) {
      where.push(`i.category_id = $${params.length + 1}`);
      params.push(filters.categoryId);
    } else {
      where.push("FALSE");
    }
  }
  if (filters.locationId !== undefined) {
    if (isValidPgInt(filters.locationId)) {
      where.push(`i.location_id = $${params.length + 1}`);
      params.push(filters.locationId);
    } else {
      where.push("FALSE");
    }
  }
  if (filters.locationGroup === "filling-cabinet") {
    where.push(`lower(l.name) = ANY($${params.length + 1})`);
    params.push([...FILLING_CABINET_LOWER]);
  } else if (filters.locationGroup === "cabi") {
    // Mutually exclusive with Filling Cabinet: an item physically on a cabinet
    // shelf stays in Filling Cabinet even if its SKU starts with CABI-.
    where.push(
      `(lower(l.name) = $${params.length + 1} OR (i.sku ILIKE $${params.length + 2} AND (l.name IS NULL OR lower(l.name) <> ALL($${params.length + 3}))))`,
    );
    params.push(CABI_LOWER, "CABI-%", [...FILLING_CABINET_LOWER]);
  } else if (filters.locationGroup === "iica") {
    where.push(`(l.name IS NULL OR lower(l.name) <> $${params.length + 1})`);
    params.push(CABI_LOWER);
    where.push(`(l.name IS NULL OR lower(l.name) <> ALL($${params.length + 1}))`);
    params.push([...FILLING_CABINET_LOWER]);
    // NULL NOT ILIKE '...' is NULL rather than true, so without the guard
    // every item without an asset code would drop out of this tab entirely.
    where.push(`(i.sku IS NULL OR i.sku NOT ILIKE $${params.length + 1})`);
    params.push("CABI-%");
  }
  if (filters.stock === "low") {
    where.push(`i.quantity > 0 AND i.quantity <= i.min_quantity AND i.condition <> ALL($${params.length + 1})`);
    params.push([...RETIRED_CONDITIONS]);
  } else if (filters.stock === "out") {
    where.push(`i.quantity = 0 AND i.condition <> ALL($${params.length + 1})`);
    params.push([...RETIRED_CONDITIONS]);
  } else if (filters.stock === "attention") {
    where.push(`i.quantity <= i.min_quantity AND i.condition <> ALL($${params.length + 1})`);
    params.push([...RETIRED_CONDITIONS]);
  }
  if (filters.excludeRetired) {
    where.push(`i.condition <> ALL($${params.length + 1})`);
    params.push([...RETIRED_CONDITIONS]);
  }
  if (filters.condition === "flagged") {
    where.push(`i.condition = ANY($${params.length + 1})`);
    params.push([...FLAGGED_CONDITIONS]);
  } else if (filters.condition === "retired") {
    where.push(`i.condition = ANY($${params.length + 1})`);
    params.push([...RETIRED_CONDITIONS]);
  } else if (filters.condition && isCondition(filters.condition)) {
    where.push(`i.condition = $${params.length + 1}`);
    params.push(filters.condition);
  }
  return { where, params };
}

export async function listItems(filters: ItemFilters = {}): Promise<ItemRow[]> {
  const { where, params } = itemWhere(filters);

  const orderBy =
    filters.sort === "quantity"
      ? "i.quantity ASC, i.id ASC"
      : filters.sort === "units"
        ? "i.quantity DESC, lower(i.name) ASC, i.id ASC"
        : filters.sort === "value"
          ? "(i.quantity * i.unit_cost) DESC, i.id ASC"
          : filters.sort === "updated"
            ? "i.updated_at DESC, i.id ASC"
            : "lower(i.name) ASC, i.id ASC";

  const page = filters.page && Number.isFinite(filters.page) && filters.page > 0 ? Math.trunc(filters.page) : undefined;
  const perPage =
    filters.perPage && Number.isFinite(filters.perPage) && filters.perPage > 0
      ? Math.min(100_000, Math.trunc(filters.perPage))
      : undefined;
  let pagination = "";
  if (page && perPage) {
    const offset = (page - 1) * perPage;
    if (offset > MAX_PG_INT) return [];
    pagination = ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(perPage, offset);
  }
  const query = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy}${pagination}`;
  return sql.unsafe<ItemRow[]>(query, params as never[]);
}

export async function countFilteredItems(filters: ItemFilters = {}): Promise<number> {
  const { where, params } = itemWhere(filters);
  const query = `SELECT COUNT(*)::int AS count FROM items i LEFT JOIN locations l ON l.id = i.location_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const [row] = await sql.unsafe<{ count: number }[]>(query, params as never[]);
  return row?.count ?? 0;
}

/**
 * Total value across the entire filtered selection (not just the visible page),
 * excluding retired (`DECOMMISSIONED`/`DISPOSED`) assets so written-off stock
 * does not inflate active valuation.
 */
export async function sumFilteredItemsValue(filters: ItemFilters = {}): Promise<number> {
  const { where, params } = itemWhere(filters);
  where.push(`i.condition <> ALL($${params.length + 1})`);
  params.push([...RETIRED_CONDITIONS]);
  const query = `SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0)::float8 AS value FROM items i LEFT JOIN locations l ON l.id = i.location_id WHERE ${where.join(" AND ")}`;
  const [row] = await sql.unsafe<{ value: number }[]>(query, params as never[]);
  return Number(row?.value ?? 0);
}

export type ItemPickerOption = {
  id: number;
  name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  location_name: string | null;
  condition: Condition;
};

/** Lightweight item projection for movement pickers and filters. */
export async function listItemPickerOptions(): Promise<ItemPickerOption[]> {
  return sql<ItemPickerOption[]>`
    SELECT i.id, i.name, i.sku, i.quantity, i.unit, l.name AS location_name, i.condition
    FROM items i
    LEFT JOIN locations l ON l.id = i.location_id
    ORDER BY lower(i.name) ASC, i.id ASC`;
}

export const getItem = cache(async (id: number): Promise<ItemRow | undefined> => {
  if (!isValidPgInt(id)) return undefined;
  const rows = await sql.unsafe<ItemRow[]>(`${ITEM_SELECT} WHERE i.id = $1`, [id] as never[]);
  return rows[0];
});

export type MovementFilters = {
  itemId?: number;
  type?: "IN" | "OUT" | "ADJUST";
  search?: string;
  limit?: number;
  page?: number;
  perPage?: number;
};

function movementWhere(filters: MovementFilters): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.itemId !== undefined) {
    if (isValidPgInt(filters.itemId)) {
      where.push(`m.item_id = $${params.length + 1}`);
      params.push(filters.itemId);
    } else {
      where.push("FALSE");
    }
  }
  if (filters.type && ["IN", "OUT", "ADJUST"].includes(filters.type)) {
    where.push(`m.type = $${params.length + 1}`);
    params.push(filters.type);
  }
  if (filters.search) {
    const n = params.length + 1;
    where.push(
      `(i.name ILIKE $${n} OR i.sku ILIKE $${n} OR m.note ILIKE $${n} OR COALESCE(u.name, m.user_label) ILIKE $${n})`,
    );
    params.push(`%${escapeIlike(filters.search)}%`);
  }
  return { where, params };
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.item_id, m.type, m.quantity, m.balance_after, m.note, m.created_at,
         i.name AS item_name, i.sku AS item_sku, COALESCE(u.name, m.user_label) AS user_name
  FROM movements m
  JOIN items i ON i.id = m.item_id
  LEFT JOIN users u ON u.id = m.user_id
`;

export async function listMovements(options: MovementFilters = {}): Promise<MovementRow[]> {
  const { where, params } = movementWhere(options);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const page =
    options.page && Number.isFinite(options.page) && options.page > 0
      ? Math.trunc(options.page)
      : undefined;
  const perPage =
    options.perPage && Number.isFinite(options.perPage) && options.perPage > 0
      ? Math.min(100_000, Math.trunc(options.perPage))
      : undefined;

  if (page && perPage) {
    const offset = (page - 1) * perPage;
    if (offset > MAX_PG_INT) return [];
    const query = `${MOVEMENT_SELECT} ${clause} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    return sql.unsafe<MovementRow[]>(query, [...params, perPage, offset] as never[]);
  }

  const limit =
    options.limit && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(100_000, Math.trunc(options.limit))
      : 50;
  const query = `${MOVEMENT_SELECT} ${clause} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length + 1}`;
  return sql.unsafe<MovementRow[]>(query, [...params, limit] as never[]);
}

export async function countFilteredMovements(
  filters: Omit<MovementFilters, "limit" | "page" | "perPage"> = {},
): Promise<number> {
  const { where, params } = movementWhere(filters);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const query = `
    SELECT COUNT(*)::int AS count
    FROM movements m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id
    ${clause}`;
  const [row] = await sql.unsafe<{ count: number }[]>(query, params as never[]);
  return row?.count ?? 0;
}

export async function listMovementsPage(
  filters: MovementFilters & { page: number; perPage: number },
): Promise<{ rows: MovementRow[]; total: number }> {
  const page = Math.max(1, Math.trunc(filters.page) || 1);
  const perPage = Math.min(100_000, Math.max(1, Math.trunc(filters.perPage) || 50));
  const [rows, total] = await Promise.all([
    listMovements({ ...filters, page, perPage }),
    countFilteredMovements(filters),
  ]);
  return { rows, total };
}

/** Total items in the catalogue, for the Inventory tab badge. */
export async function countItems(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM items`;
  return row?.count ?? 0;
}

/** Total movements on record, for the Inventory tab badge. */
export async function countMovements(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM movements`;
  return row?.count ?? 0;
}

export async function listCategories(): Promise<TaxonomyRow[]> {
  return sql<TaxonomyRow[]>`
    SELECT c.id, c.name, c.description, c.created_at, COUNT(i.id)::int AS item_count
    FROM categories c
    LEFT JOIN items i ON i.category_id = c.id
    GROUP BY c.id, c.name, c.description, c.created_at
    ORDER BY lower(c.name), c.id`;
}

export async function listLocations(): Promise<TaxonomyRow[]> {
  return sql<TaxonomyRow[]>`
    SELECT l.id, l.name, l.description, l.created_at, COUNT(i.id)::int AS item_count
    FROM locations l
    LEFT JOIN items i ON i.location_id = l.id
    GROUP BY l.id, l.name, l.description, l.created_at
    ORDER BY lower(l.name), l.id`;
}

export async function listCalendarEvents(from: Date, to: Date): Promise<CalendarEventRow[]> {
  return sql<CalendarEventRow[]>`
    SELECT e.id, e.title, e.description, e.event_type, e.starts_at, e.ends_at, e.all_day,
           e.location, e.organiser_id, u.name AS organiser_name, e.source, e.updated_at
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.organiser_id
    WHERE e.starts_at < ${to} AND e.ends_at > ${from}
    ORDER BY e.starts_at, e.ends_at, lower(e.title), e.id`;
}

export async function listVendors(search = "", page = 1, perPage = 20): Promise<{ rows: VendorRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * perPage;
  const term = `%${escapeIlike(search)}%`;
  const where = search
    ? sql`WHERE name ILIKE ${term} OR category ILIKE ${term} OR service ILIKE ${term} OR contact_person ILIKE ${term} OR email ILIKE ${term}`
    : sql``;
  const [rows, count] = await Promise.all([
    sql<VendorRow[]>`SELECT id,category,service,name,phone,contact_person,email,notes,updated_at FROM vendors ${where} ORDER BY lower(category), lower(name) LIMIT ${perPage} OFFSET ${offset}`,
    sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM vendors ${where}`,
  ]);
  return { rows, total: count[0]?.count ?? 0 };
}

export async function listUsers(): Promise<UserRow[]> {
  return sql<UserRow[]>`
    SELECT id, name, email, role, status, must_change_password, created_at, last_login_at
    FROM users ORDER BY lower(name), id`;
}

export type AuditRow = {
  id: number;
  user_label: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  created_at: Date;
};

export async function listAuditLogs(limit = 100): Promise<AuditRow[]> {
  return sql<AuditRow[]>`
    SELECT id, user_label, action, entity, entity_id, details, created_at
    FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
}

export type AuditFilters = {
  /** Free text over who did it, what it touched and the details. */
  search?: string;
  /** One of the groups in AUDIT_CATEGORIES, not a raw action name. */
  category?: string;
  /** Logical app module key in AUDIT_MODULES. */
  module?: string;
  page?: number;
  perPage?: number;
};

export const AUDIT_MODULES: Record<string, { label: string; entities: string[] }> = {
  inventory: {
    label: "Inventory & stock",
    entities: ["item", "movement", "category", "location", "reference entry", "reference list"],
  },
  vendors: {
    label: "Vendors",
    entities: ["vendor", "vendor_engagement"],
  },
  calendar: {
    label: "Calendar",
    entities: ["calendar_event"],
  },
  stakeholders: {
    label: "Stakeholders",
    entities: ["stakeholder", "stakeholder_group", "stakeholdergroup"],
  },
  timelines: {
    label: "Timelines",
    entities: ["task", "timeline", "staff_task"],
  },
  projects: {
    label: "Projects",
    entities: ["project", "project_staff", "project_stakeholder", "project_funding", "project_update", "project_action", "project_document", "project_lesson", "project_reference"],
  },
  users: {
    label: "Users & access",
    entities: ["user", "session", "permissions", "profile", "system"],
  },
};

/**
 * Actions grouped into the handful of categories worth filtering by. The raw
 * action names are an implementation detail; these are what the screen offers.
 */
export const AUDIT_CATEGORIES: Record<string, { label: string; actions: string[] }> = {
  access: {
    label: "Sign-ins & passwords",
    actions: ["SIGN_IN", "SIGN_OUT", "RESET_PASSWORD", "CHANGE_PASSWORD"],
  },
  stock: { label: "Stock movements", actions: ["MOVEMENT_IN", "MOVEMENT_OUT", "MOVEMENT_ADJUST"] },
  condition: { label: "Condition changes", actions: ["CONDITION_CHANGE"] },
  created: { label: "Created", actions: ["CREATE"] },
  updated: { label: "Updated", actions: ["UPDATE"] },
  deleted: { label: "Deleted", actions: ["DELETE"] },
  imports: { label: "Imports", actions: ["IMPORT"] },
  system: { label: "System", actions: ["SEED", "SETUP"] },
};

export type AuditPage = { rows: AuditRow[]; total: number };

function auditWhere(filters: { search?: string; category?: string; module?: string }): {
  clause: string;
  params: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    const n = params.length + 1;
    where.push(
      `(user_label ILIKE $${n} OR details ILIKE $${n} OR entity ILIKE $${n} OR action ILIKE $${n} OR replace(action, '_', ' ') ILIKE $${n} OR entity_id ILIKE $${n})`,
    );
    params.push(`%${escapeIlike(filters.search)}%`);
  }

  const mod = filters.module ? AUDIT_MODULES[filters.module] : undefined;
  if (mod) {
    where.push(`lower(entity) = ANY($${params.length + 1})`);
    params.push(mod.entities);
  }

  const group = filters.category ? AUDIT_CATEGORIES[filters.category] : undefined;
  if (group) {
    // MOVEMENT_* are prefixed, the rest are exact - handle both.
    const exact = group.actions.filter((a) => !a.startsWith("MOVEMENT_"));
    const clauses: string[] = [];
    if (exact.length > 0) {
      clauses.push(`action = ANY($${params.length + 1})`);
      params.push(exact);
    }
    if (group.actions.some((a) => a.startsWith("MOVEMENT_"))) {
      clauses.push("action LIKE 'MOVEMENT_%'");
    }
    where.push(`(${clauses.join(" OR ")})`);
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/**
 * How many entries fall in each category, so the tabs can carry counts and an
 * empty category is obvious before you click it. One pass over the table.
 */
export async function auditCategoryCounts(
  search?: string,
  moduleKey?: string,
): Promise<Record<string, number> & { all: number }> {
  const { clause, params } = auditWhere({ search, module: moduleKey });
  const rows = await sql.unsafe<{ action: string; count: number }[]>(
    `SELECT action, COUNT(*)::int AS count
     FROM audit_logs
     ${clause}
     GROUP BY action`,
    params as never[],
  );

  const counts: Record<string, number> & { all: number } = { all: 0 };
  for (const key of Object.keys(AUDIT_CATEGORIES)) counts[key] = 0;

  for (const { action, count } of rows) {
    counts.all += count;
    for (const [key, group] of Object.entries(AUDIT_CATEGORIES)) {
      const matches = group.actions.some((a) =>
        a.startsWith("MOVEMENT_") ? action.startsWith("MOVEMENT_") : a === action,
      );
      if (matches) counts[key] += count;
    }
  }
  return counts;
}

export async function listAuditPage(
  filters: AuditFilters & { page: number; perPage: number },
): Promise<AuditPage> {
  const { clause, params } = auditWhere(filters);
  const perPage = Math.min(1000, Math.max(1, Math.trunc(filters.perPage) || 25));
  const page = Math.max(1, Math.trunc(filters.page) || 1);
  const offset = (page - 1) * perPage;

  const [countRow] = await sql.unsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count FROM audit_logs ${clause}`,
    params as never[],
  );
  const total = countRow?.count ?? 0;

  if (total === 0 || offset > MAX_PG_INT) {
    return { rows: [], total };
  }

  const rows = await sql.unsafe<AuditRow[]>(
    `SELECT id, user_label, action, entity, entity_id, details, created_at
     FROM audit_logs
     ${clause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset] as never[],
  );

  return { rows, total };
}

export type DashboardStats = {
  totalItems: number;
  totalUnits: number;
  totalValue: number;
  lowStock: number;
  outOfStock: number;
  categories: number;
  locations: number;
  activeUsers: number;
  movementsThisWeek: number;
};

export async function dashboardStats(): Promise<DashboardStats> {
  const [row] = await sql<DashboardStats[]>`
    SELECT
      (SELECT COUNT(*)::int FROM items) AS "totalItems",
      (SELECT COALESCE(SUM(quantity), 0)::int FROM items WHERE condition <> ALL(${[...RETIRED_CONDITIONS]})) AS "totalUnits",
      (SELECT COALESCE(SUM(quantity * unit_cost), 0)::float8 FROM items WHERE condition <> ALL(${[...RETIRED_CONDITIONS]})) AS "totalValue",
      (SELECT COUNT(*)::int FROM items WHERE quantity > 0 AND quantity <= min_quantity AND condition <> ALL(${[...RETIRED_CONDITIONS]})) AS "lowStock",
      (SELECT COUNT(*)::int FROM items WHERE quantity = 0 AND condition <> ALL(${[...RETIRED_CONDITIONS]})) AS "outOfStock",
      (SELECT COUNT(*)::int FROM categories) AS categories,
      (SELECT COUNT(*)::int FROM locations) AS locations,
      (SELECT COUNT(*)::int FROM users WHERE status = 'ACTIVE') AS "activeUsers",
      (SELECT COUNT(*)::int FROM movements WHERE created_at >= now() - interval '7 days')
        AS "movementsThisWeek"`;
  return row;
}

export type BreakdownRow = {
  id?: number | null;
  name: string;
  items: number;
  units: number;
  value: number;
};

export async function stockByCategory(): Promise<BreakdownRow[]> {
  return sql<BreakdownRow[]>`
    SELECT c.id AS id,
           COALESCE(c.name, 'Uncategorised') AS name,
           COUNT(i.id)::int AS items,
           COALESCE(SUM(i.quantity), 0)::int AS units,
           COALESCE(SUM(i.quantity * i.unit_cost), 0)::float8 AS value
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    WHERE i.condition <> ALL(${[...RETIRED_CONDITIONS]})
    GROUP BY c.id, c.name
    ORDER BY value DESC, lower(COALESCE(c.name, 'Uncategorised')) ASC, c.id ASC NULLS LAST`;
}

export async function stockByLocation(): Promise<BreakdownRow[]> {
  return sql<BreakdownRow[]>`
    SELECT l.id AS id,
           COALESCE(l.name, 'Unassigned') AS name,
           COUNT(i.id)::int AS items,
           COALESCE(SUM(i.quantity), 0)::int AS units,
           COALESCE(SUM(i.quantity * i.unit_cost), 0)::float8 AS value
    FROM items i
    LEFT JOIN locations l ON l.id = i.location_id
    WHERE i.condition <> ALL(${[...RETIRED_CONDITIONS]})
    GROUP BY l.id, l.name
    ORDER BY value DESC, lower(COALESCE(l.name, 'Unassigned')) ASC, l.id ASC NULLS LAST`;
}

export type TrendRow = { day: string; inbound: number; outbound: number };

export async function movementTrend(days = 14): Promise<TrendRow[]> {
  const safeDays = Math.min(365, Math.max(1, Math.trunc(days) || 14));
  const lookback = safeDays - 1;
  return sql<TrendRow[]>`
    WITH spine AS (
      SELECT generate_series(
        ((now() AT TIME ZONE ${APP_TIMEZONE})::date - ${lookback}::int),
        (now() AT TIME ZONE ${APP_TIMEZONE})::date,
        interval '1 day'
      )::date AS d
    ),
    agg AS (
      SELECT (created_at AT TIME ZONE ${APP_TIMEZONE})::date AS d,
             COALESCE(SUM(CASE
               WHEN type = 'IN' THEN quantity
               WHEN type = 'ADJUST' AND quantity > 0 THEN quantity
               ELSE 0
             END), 0)::int AS inbound,
             COALESCE(SUM(CASE
               WHEN type = 'OUT' THEN quantity
               WHEN type = 'ADJUST' AND quantity < 0 THEN -quantity
               ELSE 0
             END), 0)::int AS outbound
      FROM movements
      WHERE created_at >= (
        ((now() AT TIME ZONE ${APP_TIMEZONE})::date - ${lookback}::int)::timestamp
        AT TIME ZONE ${APP_TIMEZONE}
      )
      GROUP BY 1
    )
    SELECT to_char(s.d, 'YYYY-MM-DD') AS day,
           COALESCE(a.inbound, 0)::int AS inbound,
           COALESCE(a.outbound, 0)::int AS outbound
    FROM spine s
    LEFT JOIN agg a ON a.d = s.d
    ORDER BY s.d ASC`;
}

export async function lowStockItems(limit = 8): Promise<ItemRow[]> {
  const safeLimit = Math.min(1000, Math.max(1, Math.trunc(limit) || 8));
  return sql.unsafe<ItemRow[]>(
    `${ITEM_SELECT} WHERE i.quantity <= i.min_quantity AND i.condition <> ALL($1)
     ORDER BY (i.quantity - i.min_quantity) ASC, lower(i.name) ASC, i.id ASC LIMIT $2`,
    [[...RETIRED_CONDITIONS], safeLimit] as never[],
  );
}

const STAKEHOLDER_SELECT = `
  SELECT s.*, g.name AS group_name
  FROM stakeholders s
  LEFT JOIN stakeholder_groups g ON g.id = s.group_id
`;

export type StakeholderFilters = {
  search?: string;
  groupId?: number;
  group?: number | "ungrouped";
  has?: "all" | "email" | "phone" | "nocontact";
  sort?: "name" | "organisation" | "group" | "updated";
  /** 1-based. Omit both to fetch everything (the CSV export does). */
  page?: number;
  perPage?: number;
};

/** Shared by the list query and its count, so the two can never disagree. */
function stakeholderWhere(filters: StakeholderFilters) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    const n = params.length;
    where.push(
      `(s.name ILIKE $${n + 1} OR s.organisation ILIKE $${n + 1} OR s.email ILIKE $${n + 1}
        OR s.alt_email ILIKE $${n + 1} OR s.phone ILIKE $${n + 1} OR s.alt_phone ILIKE $${n + 1}
        OR s.job_title ILIKE $${n + 1} OR s.location ILIKE $${n + 1} OR s.notes ILIKE $${n + 1})`,
    );
    params.push(`%${escapeIlike(filters.search)}%`);
  }
  if (filters.group === "ungrouped") {
    where.push("s.group_id IS NULL");
  } else {
    const groupId = typeof filters.group === "number" ? filters.group : filters.groupId;
    if (groupId !== undefined) {
      if (isValidPgInt(groupId)) {
        where.push(`s.group_id = $${params.length + 1}`);
        params.push(groupId);
      } else {
        where.push("FALSE");
      }
    }
  }
  if (filters.has === "email") {
    where.push("((s.email IS NOT NULL AND s.email <> '') OR (s.alt_email IS NOT NULL AND s.alt_email <> ''))");
  }
  if (filters.has === "phone") {
    where.push("((s.phone IS NOT NULL AND s.phone <> '') OR (s.alt_phone IS NOT NULL AND s.alt_phone <> ''))");
  }
  if (filters.has === "nocontact") {
    where.push(
      "(s.email IS NULL OR s.email = '') AND (s.alt_email IS NULL OR s.alt_email = '') AND (s.phone IS NULL OR s.phone = '') AND (s.alt_phone IS NULL OR s.alt_phone = '')",
    );
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export type StakeholderPage = {
  rows: StakeholderRow[];
  total: number;
};

/**
 * Queries the total count alongside the current page so `total` stays accurate
 * even when `page` exceeds `pageCount`.
 */
export async function listStakeholderPage(
  filters: StakeholderFilters & { page: number; perPage: number },
): Promise<StakeholderPage> {
  const { clause, params } = stakeholderWhere(filters);
  const orderBy = stakeholderOrder(filters.sort);
  const perPage = Math.min(1000, Math.max(1, Math.trunc(filters.perPage) || 50));
  const page = Math.max(1, Math.trunc(filters.page) || 1);
  const offset = (page - 1) * perPage;

  const [countRow] = await sql.unsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count FROM stakeholders s ${clause}`,
    params as never[],
  );
  const total = countRow?.count ?? 0;

  if (total === 0 || offset > MAX_PG_INT) {
    return { rows: [], total };
  }

  const query = `
    SELECT s.*, g.name AS group_name
    FROM stakeholders s
    LEFT JOIN stakeholder_groups g ON g.id = s.group_id
    ${clause}
    ORDER BY ${orderBy}, s.id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const rows = await sql.unsafe<StakeholderRow[]>(query, [
    ...params,
    perPage,
    offset,
  ] as never[]);

  return { rows, total };
}

function stakeholderOrder(sort: StakeholderFilters["sort"]): string {
  return sort === "organisation"
    ? "lower(s.organisation) ASC NULLS LAST, lower(s.name) ASC"
    : sort === "group"
      ? "lower(g.name) ASC NULLS LAST, lower(s.name) ASC"
      : sort === "updated"
        ? "s.updated_at DESC"
        : "lower(s.name) ASC";
}

export async function listStakeholders(
  filters: StakeholderFilters = {},
): Promise<StakeholderRow[]> {
  const { clause, params } = stakeholderWhere(filters);

  const orderBy = stakeholderOrder(filters.sort);

  // `s.id` breaks ties so a row can never appear on two pages, or on none.
  let query = `${STAKEHOLDER_SELECT} ${clause} ORDER BY ${orderBy}, s.id ASC`;

  if (filters.perPage && Number.isFinite(filters.perPage) && filters.perPage > 0) {
    const perPage = Math.min(100_000, Math.trunc(filters.perPage));
    const page = Math.max(1, Math.trunc(filters.page ?? 1) || 1);
    const offset = (page - 1) * perPage;
    if (offset > MAX_PG_INT) return [];
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(perPage, offset);
  }

  return sql.unsafe<StakeholderRow[]>(query, params as never[]);
}

export const getStakeholder = cache(async (id: number): Promise<StakeholderRow | undefined> => {
  if (!isValidPgInt(id)) return undefined;
  const rows = await sql.unsafe<StakeholderRow[]>(`${STAKEHOLDER_SELECT} WHERE s.id = $1`, [
    id,
  ] as never[]);
  return rows[0];
});

export async function listStakeholderGroups(): Promise<TaxonomyRow[]> {
  // A join and one aggregate pass, rather than a correlated COUNT per group.
  return sql<TaxonomyRow[]>`
    SELECT g.id, g.name, g.description, g.created_at,
           COUNT(s.id)::int AS item_count
    FROM stakeholder_groups g
    LEFT JOIN stakeholders s ON s.group_id = g.id
    GROUP BY g.id, g.name, g.description, g.created_at
    ORDER BY lower(g.name), g.id`;
}

export type StakeholderStats = {
  total: number;
  withEmail: number;
  withPhone: number;
  groups: number;
};

export async function stakeholderStats(): Promise<StakeholderStats> {
  const [row] = await sql<StakeholderStats[]>`
    SELECT
      (SELECT COUNT(*)::int FROM stakeholders) AS total,
      (SELECT COUNT(*)::int FROM stakeholders WHERE (email IS NOT NULL AND email <> '') OR (alt_email IS NOT NULL AND alt_email <> '')) AS "withEmail",
      (SELECT COUNT(*)::int FROM stakeholders WHERE (phone IS NOT NULL AND phone <> '') OR (alt_phone IS NOT NULL AND alt_phone <> '')) AS "withPhone",
      (SELECT COUNT(*)::int FROM stakeholder_groups) AS groups`;
  return row;
}

/** Group breakdown for the dashboard, largest first. */
export async function stakeholdersByGroup(): Promise<
  { id?: number | null; name: string; count: number }[]
> {
  return sql<{ id?: number | null; name: string; count: number }[]>`
    SELECT g.id AS id, COALESCE(g.name, 'Ungrouped') AS name, COUNT(*)::int AS count
    FROM stakeholders s
    LEFT JOIN stakeholder_groups g ON g.id = s.group_id
    GROUP BY g.id, COALESCE(g.name, 'Ungrouped')
    ORDER BY count DESC, lower(COALESCE(g.name, 'Ungrouped')) ASC, g.id ASC NULLS LAST`;
}

/** How many items sit in each condition, optionally scoped to the active inventory tab/filters. */
export async function conditionCounts(
  filters: Omit<ItemFilters, "condition" | "page" | "perPage" | "sort"> = {},
): Promise<Record<string, number>> {
  const { where, params } = itemWhere({ ...filters, condition: undefined });
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await sql.unsafe<{ condition: string; count: number }[]>(
    `SELECT i.condition, COUNT(*)::int AS count
     FROM items i
     LEFT JOIN locations l ON l.id = i.location_id
     ${clause}
     GROUP BY i.condition`,
    params as never[],
  );
  return Object.fromEntries(rows.map((r) => [r.condition, r.count]));
}

/* ------------------------------------------------------------ timelines -- */

export type StaffTask = {
  id: number;
  area: string;
  position: number | null;
  title: string;
  lead: string | null;
  origin: string | null;
  priority: string;
  status: string;
  progress: number | null;
  starts_on: Date | null;
  ends_on: Date | null;
  schedule_note: string | null;
  comments: string | null;
  owner_id: number | null;
  owner_name: string | null;
  progress_note: string | null;
  progress_updated_at: Date | null;
  progress_updated_by_name: string | null;
};

export type TaskFilters = {
  area?: string;
  status?: string;
  priority?: string;
  lead?: string;
  search?: string;
  ownerId?: number;
};

function taskWhere(filters: TaskFilters): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("$?", `$${params.length}`));
  };
  if (filters.area) add("t.area = $?", filters.area);
  if (filters.status) add("t.status = $?", filters.status);
  if (filters.priority) add("t.priority = $?", filters.priority);
  if (filters.lead) {
    const escaped = filters.lead.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) {
      add("t.lead ~* $?", `(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`);
    }
  }
  if (filters.ownerId !== undefined) {
    if (isValidPgInt(filters.ownerId)) add("t.owner_id = $?", filters.ownerId);
    else where.push("FALSE");
  }
  if (filters.search) {
    params.push(`%${escapeIlike(filters.search)}%`);
    where.push(
      `(t.title ILIKE $${params.length} OR t.origin ILIKE $${params.length}` +
        ` OR t.comments ILIKE $${params.length} OR t.lead ILIKE $${params.length}` +
        ` OR t.schedule_note ILIKE $${params.length} OR o.name ILIKE $${params.length})`,
    );
  }
  return { where, params };
}

export async function listStaffTasks(filters: TaskFilters = {}): Promise<StaffTask[]> {
  const { where, params } = taskWhere(filters);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return sql.unsafe<StaffTask[]>(
    `SELECT t.id, t.area, t.position, t.title, t.lead, t.origin, t.priority, t.status,
            t.progress, t.starts_on, t.ends_on, t.schedule_note, t.comments,
            t.owner_id, o.name AS owner_name, t.progress_note, t.progress_updated_at,
            p.name AS progress_updated_by_name
       FROM staff_tasks t
       LEFT JOIN users o ON o.id = t.owner_id
       LEFT JOIN users p ON p.id = t.progress_updated_by
       ${clause}
      ORDER BY t.area, COALESCE(t.starts_on, t.ends_on) NULLS LAST, t.position NULLS LAST, t.id`,
    params as never[],
  );
}

/** Tab counts are the whole area, never the current filter. */
export async function listTaskAreas(): Promise<{ area: string; total: number }[]> {
  return sql<{ area: string; total: number }[]>`
    SELECT area, COUNT(*)::int AS total
      FROM staff_tasks
     GROUP BY area
     ORDER BY area`;
}

export async function countTasksByStatus(area?: string): Promise<Record<string, number>> {
  const rows = area
    ? await sql<{ status: string; n: number }[]>`
        SELECT status, COUNT(*)::int AS n FROM staff_tasks WHERE area = ${area} GROUP BY status`
    : await sql<{ status: string; n: number }[]>`
        SELECT status, COUNT(*)::int AS n FROM staff_tasks GROUP BY status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function listTaskLeads(): Promise<string[]> {
  const rows = await sql<{ lead: string }[]>`
    SELECT DISTINCT lead FROM staff_tasks WHERE lead IS NOT NULL AND lead <> '' ORDER BY lead`;
  return rows.map((r) => r.lead);
}

export async function listTaskOwners(): Promise<{ id: number; name: string; total: number }[]> {
  return sql<{ id: number; name: string; total: number }[]>`
    SELECT u.id, u.name, COUNT(t.id)::int AS total
      FROM users u
      JOIN staff_tasks t ON t.owner_id = u.id
     GROUP BY u.id, u.name
     ORDER BY u.name`;
}
