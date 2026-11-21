#!/usr/bin/env node
/**
 * One-shot migration of a local dump into a hosted database.
 *
 * Applies the schema, restores the data dump, resets SERIAL sequences, flags
 * every account for password rotation, and verifies all tables.
 *
 * Usage:
 *   node scripts/migrate-to-remote.mjs "<postgres connection string>" <dump.sql>
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { SCHEMA_SQL } from "../src/lib/schema.mjs";
import { ALL_TABLES, SERIAL_TABLES, createScriptSql, fail } from "./_lib.mjs";

const [, , target, dumpPath] = process.argv;
if (!target || !dumpPath) {
  fail("Usage: node scripts/migrate-to-remote.mjs <connection string> <dump.sql>");
}
if (!fs.existsSync(dumpPath)) {
  fail(`Dump not found: ${dumpPath}`);
}

function buildPsqlInvocation(connectionUrl, sqlFile) {
  const env = {
    ...process.env,
    PGOPTIONS: `${process.env.PGOPTIONS ? `${process.env.PGOPTIONS} ` : ""}-c search_path=public`,
  };
  try {
    const u = new URL(connectionUrl);
    if (u.hostname) env.PGHOST = u.hostname;
    if (u.port) env.PGPORT = u.port;
    if (u.username) env.PGUSER = decodeURIComponent(u.username);
    if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
    const dbName = u.pathname.replace(/^\/+/, "");
    if (dbName) env.PGDATABASE = decodeURIComponent(dbName);
    const sslMode = u.searchParams.get("sslmode");
    if (sslMode) env.PGSSLMODE = sslMode;
    return { args: ["-v", "ON_ERROR_STOP=1", "-q", "-f", sqlFile], env };
  } catch {
    return { args: [connectionUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", sqlFile], env };
  }
}

const sql = createScriptSql(target);

try {
  console.log("1/6  Checking the target holds no data of its own…");
  const present = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const presentSet = new Set(present.map((r) => r.tablename));
  const existing = [];
  for (const table of ALL_TABLES) {
    if (!presentSet.has(table)) continue;
    const [row] = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table}`);
    if (row.n > 0) existing.push(`${table} (${row.n})`);
  }
  if (existing.length) {
    console.error(`\nRefusing to load: the target already holds data in ${existing.join(", ")}.`);
    console.error("Restoring on top would duplicate or wipe rows. Empty those tables first.");
    process.exitCode = 1;
  } else {
    console.log("2/6  Applying schema…");
    await sql.unsafe(SCHEMA_SQL);
    await sql`
      TRUNCATE
        role_permissions,
        app_migrations,
        project_statuses,
        project_model_phases,
        project_funding_statuses,
        project_roles,
        programme_areas
      RESTART IDENTITY CASCADE`;

    console.log("3/6  Restoring data…");
    const psqlCmd = buildPsqlInvocation(target, dumpPath);
    execFileSync("psql", psqlCmd.args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: psqlCmd.env,
    });

    console.log("4/6  Synchronizing SERIAL sequences…");
    for (const table of SERIAL_TABLES) {
      await sql.unsafe(
        `SELECT setval(
           pg_get_serial_sequence('${table}', 'id'),
           GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1),
           EXISTS (SELECT 1 FROM ${table})
         )`,
      );
    }
    await sql.unsafe(SCHEMA_SQL);

    console.log("5/6  Forcing a password change and rotating session versions…");
    const rotated = await sql`
      UPDATE users
         SET must_change_password = true,
             token_version = token_version + 1
       RETURNING email`;
    console.log(`     ${rotated.length} account${rotated.length === 1 ? "" : "s"} flagged.`);

    console.log("6/6  Verifying…");
    for (const table of ALL_TABLES) {
      const [row] = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM ${table}`);
      console.log(`     ${table.padEnd(26)} ${row.n}`);
    }
    console.log("\nDone.");
  }
} catch (error) {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
