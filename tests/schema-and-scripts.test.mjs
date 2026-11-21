import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCHEMA_SQL } from "../src/lib/schema.mjs";
import {
  ALL_TABLES,
  DEFAULT_ROLE_PERMISSIONS as SCRIPT_DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS as SCRIPT_PERMISSIONS,
  SERIAL_TABLES,
  cellText,
  hashPassword,
  resolveDatabaseUrl,
} from "../scripts/_lib.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

const { verifyPassword } = loadTs("src/lib/password.ts");
const { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } = loadTs("src/lib/roles.ts");

describe("schema.mjs", () => {
  it("does not pre-insert role_permissions rows on an empty fresh database (prevents admin lockout)", () => {
    // Later releases grant new permissions to existing matrices once each. Every
    // such insert must be a one-off migration and only run when a matrix exists,
    // so a fresh database is still seeded from the defaults by the app.
    const matches = [...SCHEMA_SQL.matchAll(/INSERT\s+INTO\s+role_permissions\b/gi)];
    assert.ok(matches.length >= 1, "Expected the one-off permission grant migrations in SCHEMA_SQL");
    for (const m of matches) {
      const before = SCHEMA_SQL.slice(Math.max(0, m.index - 260), m.index);
      assert.match(before, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+role_permissions\s*\)/i);
      assert.match(before, /app_migrations\s+WHERE\s+key\s*=\s*'[a-z_]+_permissions_v\d+'/i);
    }
  });

  it("declares core, project, vendor, calendar, and timeline tables and constraints", () => {
    for (const table of [
      "users",
      "role_permissions",
      "categories",
      "locations",
      "items",
      "movements",
      "stakeholder_groups",
      "stakeholders",
      "vendors",
      "vendor_engagements",
      "dashboard_layouts",
      "calendar_events",
      "calendar_sync_config",
      "staff_tasks",
      "audit_logs",
      "app_migrations",
      "projects",
      "project_statuses",
      "project_model_phases",
      "project_funding_statuses",
      "project_roles",
      "programme_areas",
      "project_tag_list",
      "project_staff",
      "project_stakeholders",
      "project_funding",
      "project_updates",
      "project_actions",
      "document_resources",
      "project_documents",
      "project_lessons",
    ]) {
      assert.match(
        SCHEMA_SQL,
        new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"),
        `Missing table ${table} in SCHEMA_SQL`,
      );
    }

    assert.match(SCHEMA_SQL, /CONSTRAINT\s+calendar_event_times\s+CHECK\s*\(\s*ends_at\s*>\s*starts_at\s*\)/i);
    assert.match(SCHEMA_SQL, /chk_staff_tasks_progress/i);
    assert.match(SCHEMA_SQL, /chk_staff_tasks_dates/i);
    assert.match(SCHEMA_SQL, /chk_vendors_rating/i);
  });
});

describe("scripts/_lib.mjs", () => {
  it("lists all 38 tables in dependency-safe DROP order (children before parents)", () => {
    assert.equal(ALL_TABLES.length, 38);
    assert.equal(SERIAL_TABLES.length, 30);
    assert.deepEqual(SCRIPT_PERMISSIONS, PERMISSIONS);
    assert.deepEqual(SCRIPT_DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS);

    const idx = (name) => ALL_TABLES.indexOf(name);
    for (const [child, parent] of [
      ["movements", "items"],
      ["items", "categories"],
      ["items", "locations"],
      ["stakeholders", "stakeholder_groups"],
      ["vendor_engagements", "vendors"],
      ["dashboard_layouts", "users"],
      ["role_permissions", "users"],
      ["audit_logs", "users"],
      ["project_actions", "projects"],
      ["project_files", "document_resources"],
      ["notifications", "users"],
      ["comments", "users"],
      ["saved_views", "users"],
      ["reminder_log", "users"],
      ["projects", "project_statuses"],
    ]) {
      assert.ok(idx(child) !== -1 && idx(parent) !== -1, `Missing ${child} or ${parent}`);
      assert.ok(idx(child) < idx(parent), `Expected ${child} before ${parent} in ALL_TABLES`);
    }
    assert.ok(SERIAL_TABLES.includes("users"));
    assert.ok(SERIAL_TABLES.includes("staff_tasks"));
    assert.ok(SERIAL_TABLES.includes("projects"));
  });

  it("extracts plain text cleanly from ExcelJS cell value variants", () => {
    assert.equal(cellText(null), "");
    assert.equal(cellText("hello"), "hello");
    assert.equal(cellText(42), "42");
    assert.equal(cellText(new Date("2026-05-01T15:30:00Z")), "2026-05-01");
    assert.equal(cellText({ richText: [{ text: "Part A " }, { text: "Part B" }] }), "Part A Part B");
    assert.equal(cellText({ formula: "A1+B1", result: 120 }), "120");
    assert.equal(cellText({ result: { error: "#REF!" } }), "");
    assert.equal(cellText({ hyperlink: "mailto:info@iica.int", text: "info@iica.int" }), "info@iica.int");
    assert.equal(cellText({ hyperlink: "mailto:contact@iica.int" }), "contact@iica.int");
  });

  it("resolves database URLs preferring unpooled endpoints first", () => {
    const keys = [
      "DATABASE_URL_UNPOOLED",
      "POSTGRES_URL_NON_POOLING",
      "DATABASE_URL",
      "POSTGRES_URL",
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      assert.equal(resolveDatabaseUrl(), "");

      process.env.POSTGRES_URL = "postgres://pooled-fallback";
      assert.equal(resolveDatabaseUrl(), "postgres://pooled-fallback");

      process.env.DATABASE_URL = "postgres://db-url";
      assert.equal(resolveDatabaseUrl(), "postgres://db-url");

      process.env.POSTGRES_URL_NON_POOLING = "postgres://non-pooling";
      assert.equal(resolveDatabaseUrl(), "postgres://non-pooling");

      process.env.DATABASE_URL_UNPOOLED = "postgres://unpooled";
      assert.equal(resolveDatabaseUrl(), "postgres://unpooled");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("hashes passwords compatibly with src/lib/password.ts verifyPassword", async () => {
    const stored = await hashPassword("Trinidad2026!");
    assert.match(stored, /^scrypt\$32768:8:1\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.equal(await verifyPassword("Trinidad2026!", stored), true);
    assert.equal(await verifyPassword("WrongPassword1", stored), false);
  });
});
