#!/usr/bin/env node
/**
 * Creates the schema, permission defaults, and the first administrator.
 *
 *   npm run seed                       -> schema + defaults + administrator
 *   npm run seed -- --reset            -> drops all tables and rebuilds
 */
import { SCHEMA_SQL } from "../src/lib/schema.mjs";
import {
  ALL_TABLES,
  DEFAULT_ROLE_PERMISSIONS,
  createScriptSql,
  fail,
  hashPassword,
  loadEnvFiles,
  resolveDatabaseUrl,
} from "./_lib.mjs";

const args = new Set(process.argv.slice(2));
const reset = args.has("--reset");

loadEnvFiles();

const DATABASE_URL = resolveDatabaseUrl();
if (!DATABASE_URL) {
  fail(
    "\nDATABASE_URL is not set.\n\n" +
      "Create .env.local with a line like:\n" +
      "  DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require\n\n" +
      "Free PostgreSQL hosting: neon.tech or supabase.com\n",
  );
}

const ADMIN_NAME = process.env.ADMIN_NAME || "IICA Administrator";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@iica.org").toLowerCase();
const USING_DEFAULT_PASSWORD = !process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123";

const sql = createScriptSql(DATABASE_URL);

try {
  await main();
} catch (error) {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}

async function main() {
  if (reset) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${ALL_TABLES.join(", ")} CASCADE;`);
    console.log(`• Dropped ${ALL_TABLES.length} tables`);
  }

  await sql.unsafe(SCHEMA_SQL);
  console.log("• Schema is up to date");

  const [{ n: permCount }] = await sql`SELECT COUNT(*)::int AS n FROM role_permissions`;
  if (permCount === 0) {
    const rows = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, permissions]) =>
      permissions.map((permission) => ({ role, permission })),
    );
    await sql.begin(async (tx) => {
      for (const row of rows) {
        await tx`
          INSERT INTO role_permissions (role, permission)
          VALUES (${row.role}, ${row.permission})
          ON CONFLICT DO NOTHING`;
      }
    });
    console.log(`• Seeded ${rows.length} default role permissions`);
  }

  const syncUrl = process.env.SHAREPOINT_CALENDAR_URL?.trim() || "";
  await sql`
    INSERT INTO calendar_sync_config
      (id, sharepoint_url, auto_sync_enabled, sync_interval_minutes, prune_deleted, last_status, last_message)
    VALUES
      (1, ${syncUrl}, ${Boolean(syncUrl)}, 15, true, 'READY', ${syncUrl ? "Auto-sync active" : "SharePoint URL not yet configured"})
    ON CONFLICT (id) DO NOTHING`;

  const [existing] = await sql`SELECT id FROM users WHERE lower(email) = ${ADMIN_EMAIL}`;
  if (existing) {
    console.log(`• Administrator ${ADMIN_EMAIL} already exists - left untouched`);
  } else {
    const mustChange = USING_DEFAULT_PASSWORD || ADMIN_PASSWORD === "ChangeMe123";
    const [row] = await sql`
      INSERT INTO users (name, email, password_hash, role, status, must_change_password)
      VALUES (${ADMIN_NAME}, ${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'ADMIN', 'ACTIVE', ${mustChange})
      RETURNING id`;
    await sql`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (NULL, 'system (seed script)', 'SEED', 'user', ${String(row.id)},
              ${`Initial administrator created: ${ADMIN_EMAIL}`})`;
    console.log(`• Administrator created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    if (mustChange) {
      console.log("  (Password change required on first sign-in)");
    }
  }

  console.log("\nDone. Start the app with `npm run dev` and sign in.");
}
