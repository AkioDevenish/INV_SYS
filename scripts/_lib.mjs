import fs from "node:fs";
import path from "node:path";
import { randomBytes, scrypt } from "node:crypto";
import postgres from "postgres";

const KEY_LENGTH = 64;
const DEFAULT_SCRYPT_N = 32768;
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;
const MAX_SCRYPT_MEM = 64 * 1024 * 1024;

/** All 33 tables in dependency-safe DROP order (children before parents). */
export const ALL_TABLES = [
  "project_lessons",
  "project_documents",
  "document_resources",
  "project_actions",
  "project_updates",
  "project_funding",
  "project_stakeholders",
  "project_staff",
  "project_tags",
  "project_programme_areas",
  "projects",
  "project_tag_list",
  "programme_areas",
  "project_roles",
  "project_funding_statuses",
  "project_model_phases",
  "project_statuses",
  "app_migrations",
  "audit_logs",
  "movements",
  "items",
  "categories",
  "locations",
  "stakeholders",
  "stakeholder_groups",
  "vendor_engagements",
  "vendors",
  "calendar_events",
  "calendar_sync_config",
  "staff_tasks",
  "dashboard_layouts",
  "role_permissions",
  "users",
];

/** Tables backed by a SERIAL `id` primary key sequence. */
export const SERIAL_TABLES = [
  "users",
  "categories",
  "locations",
  "items",
  "movements",
  "stakeholder_groups",
  "stakeholders",
  "vendors",
  "vendor_engagements",
  "calendar_events",
  "staff_tasks",
  "audit_logs",
  "project_statuses",
  "project_model_phases",
  "project_funding_statuses",
  "project_roles",
  "programme_areas",
  "project_tag_list",
  "projects",
  "project_staff",
  "project_stakeholders",
  "project_funding",
  "project_updates",
  "project_actions",
  "document_resources",
  "project_lessons",
];

export const PERMISSIONS = [
  "inventory.view",
  "inventory.manage",
  "movement.record",
  "taxonomy.manage",
  "reports.view",
  "stakeholders.view",
  "stakeholders.manage",
  "users.manage",
  "audit.view",
  "calendar.view",
  "calendar.manage",
  "timelines.view",
  "timelines.manage",
  "projects.view",
  "projects.manage",
];

export const DEFAULT_ROLE_PERMISSIONS = {
  VIEWER: [
    "inventory.view",
    "reports.view",
    "stakeholders.view",
    "calendar.view",
    "timelines.view",
    "projects.view",
  ],
  STAFF: [
    "inventory.view",
    "reports.view",
    "stakeholders.view",
    "movement.record",
    "calendar.view",
    "timelines.view",
    "projects.view",
  ],
  MANAGER: [
    "inventory.view",
    "reports.view",
    "movement.record",
    "inventory.manage",
    "taxonomy.manage",
    "stakeholders.view",
    "stakeholders.manage",
    "calendar.view",
    "calendar.manage",
    "timelines.view",
    "timelines.manage",
    "projects.view",
    "projects.manage",
  ],
  ADMIN: [...PERMISSIONS],
};

export const INITIALS_ALIASES = {
  DEF: "Diana Francis",
  DF: "Diana Francis",
  LH: "Lisa Harrynanan",
  RR: "Richard Rampersaud",
  MA: "Mercedes Archer",
  JL: "Junnel Lewis",
  GH: "Geselle Hodge",
  GEH: "Geselle Hodge",
  SE: "Salisha Estrada",
  VAB: "Veronica Alleyne-Bailey",
  VB: "Veronica Alleyne-Bailey",
  EF: "Edwin Franco",
  AD: "Akio Devenish",
  EC: "Earllene Crawford",
};

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === "\\" && quote === '"' && i + 1 < trimmed.length) {
        i++;
        continue;
      }
      if (trimmed[i] === quote) {
        return trimmed.slice(1, i);
      }
    }
    return trimmed.slice(1);
  }
  const commentIdx = trimmed.search(/\s+#/);
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
}

/** Loads `.env.local` then `.env` safely across LF/CRLF line endings. */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

export function resolveDatabaseUrl() {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  );
}

export function createScriptSql(url, extraOptions = {}) {
  return postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connection: { search_path: "public" },
    ...extraOptions,
  });
}

/** Matches src/lib/password.ts `hashPassword`. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: DEFAULT_SCRYPT_N, r: DEFAULT_SCRYPT_R, p: DEFAULT_SCRYPT_P, maxmem: MAX_SCRYPT_MEM },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
  return `scrypt$${DEFAULT_SCRYPT_N}:${DEFAULT_SCRYPT_R}:${DEFAULT_SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Extracts plain text from primitive, Date, richText, formula, or hyperlink cells. */
export function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value.richText)) {
    return value.richText.map((run) => run.text ?? "").join("");
  }
  if (value.text != null) {
    const inner = cellText(value.text);
    if (inner.trim()) return inner;
  }
  if (value.result != null && typeof value.result !== "object") {
    return cellText(value.result);
  }
  if (value.result != null && typeof value.result === "object" && !("error" in value.result)) {
    return cellText(value.result);
  }
  if (value.hyperlink) {
    return String(value.hyperlink).replace(/^mailto:/i, "");
  }
  return "";
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}
