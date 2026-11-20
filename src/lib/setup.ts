import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { SCHEMA_SQL } from "./schema.mjs";

const SCHEMA_HASH = createHash("sha256")
  .update(SCHEMA_SQL)
  .update("token_version_v1")
  .digest("hex")
  .slice(0, 16);
const SCHEMA_MARKER = `schema_${SCHEMA_HASH}`;

async function isSchemaApplied(): Promise<boolean> {
  try {
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM app_migrations WHERE key = ${SCHEMA_MARKER}) AS ok`;
    return Boolean(row?.ok);
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return false;
    throw err;
  }
}

/**
 * Ensures database schema exists once per process and once per schema revision,
 * avoiding heavy DDL locks inside concurrent request bursts.
 */
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    try {
      if (!(await isSchemaApplied())) {
        await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(742109)`;
          const [tbl] = await tx<{ exists: boolean }[]>`
            SELECT to_regclass('public.app_migrations') IS NOT NULL AS exists`;
          let already = false;
          if (tbl?.exists) {
            const [row] = await tx<{ ok: boolean }[]>`
              SELECT EXISTS (SELECT 1 FROM app_migrations WHERE key = ${SCHEMA_MARKER}) AS ok`;
            already = Boolean(row?.ok);
          }
          if (!already) {
            await tx.unsafe(SCHEMA_SQL);
            await tx.unsafe(
              "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;",
            );
            await tx`
              INSERT INTO app_migrations (key) VALUES (${SCHEMA_MARKER}) ON CONFLICT DO NOTHING`;
          }
        });
      }
      void ensureSearchIndexes();
    } catch (error) {
      // Let the next request retry rather than caching a failure forever.
      schemaReady = null;
      throw error;
    }
  })();
  return schemaReady;
}

/**
 * Trigram indexes turn the directory's `ILIKE '%term%'` search from a full scan
 * into an index lookup, which is what keeps search quick as the directory grows.
 *
 * They need the `pg_trgm` extension, and not every managed Postgres lets an
 * application role install extensions. That is why this is separate from
 * `ensureSchema`: a permission error here must not take the whole schema
 * bootstrap - and therefore the whole app - down with it. Without the index the
 * search still returns exactly the same rows, just by scanning.
 */
let searchIndexesReady: Promise<void> | null = null;
let searchIndexesRetryAfter = 0;

const SEARCH_INDEX_STATEMENTS = [
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_name ON stakeholders USING gin (name gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_org ON stakeholders USING gin (organisation gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_email ON stakeholders USING gin (email gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_alt_email ON stakeholders USING gin (alt_email gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_phone ON stakeholders USING gin (phone gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_alt_phone ON stakeholders USING gin (alt_phone gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_job_title ON stakeholders USING gin (job_title gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_location ON stakeholders USING gin (location gin_trgm_ops)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stake_trgm_notes ON stakeholders USING gin (notes gin_trgm_ops)",
] as const;

export function ensureSearchIndexes(): Promise<void> {
  if (searchIndexesReady) return searchIndexesReady;
  if (Date.now() < searchIndexesRetryAfter) return Promise.resolve();

  searchIndexesReady = (async () => {
    try {
      const [existing] = await sql<{ ok: boolean }[]>`
        SELECT (
          to_regclass('public.idx_stake_trgm_name') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_org') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_email') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_alt_email') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_phone') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_alt_phone') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_job_title') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_location') IS NOT NULL
          AND to_regclass('public.idx_stake_trgm_notes') IS NOT NULL
        ) AS ok`;
      if (existing?.ok) return;

      // Run each statement individually so CREATE INDEX CONCURRENTLY stays
      // outside any implicit multi-statement transaction block and avoids SHARE locks.
      for (const stmt of SEARCH_INDEX_STATEMENTS) {
        await sql.unsafe(stmt);
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      // Do not cache transient DB failures forever; back off briefly before retrying.
      // Only cache permanently when the DB role lacks privilege to install extensions.
      if (code !== "42501") {
        searchIndexesReady = null;
        searchIndexesRetryAfter = Date.now() + 60_000;
      }
      console.warn(
        "pg_trgm indexes unavailable, stakeholder search will scan instead:",
        error instanceof Error ? error.message : error,
      );
    }
  })();
  return searchIndexesReady;
}

/**
 * True only when both `users` and `audit_logs` are empty — matching the exact
 * insert guard in `completeSetupAction` so `/login` and `/setup` can never
 * enter a redirect loop.
 */
export async function needsSetup(): Promise<boolean> {
  await ensureSchema();
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT (
      NOT EXISTS (SELECT 1 FROM users)
      AND NOT EXISTS (SELECT 1 FROM audit_logs)
    ) AS ok`;
  return Boolean(row?.ok);
}
