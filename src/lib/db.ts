import postgres from "postgres";

type Client = ReturnType<typeof postgres>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return LOCAL_HOSTS.has(lower) || lower.endsWith(".local");
}

export function resolveSslOption(
  url: string,
): "require" | "prefer" | "allow" | boolean | { rejectUnauthorized: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined;
  }

  const local = isLocalHostname(parsed.hostname);
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();

  if (local) {
    if (sslMode === "verify-full" || sslMode === "verify-ca") {
      return { rejectUnauthorized: true };
    }
    return sslMode === "require" ? "require" : false;
  }

  if (sslMode === "disable") return false;

  if (process.env.NODE_ENV === "production") {
    // Default remote production TLS to full certificate verification (postgres.js
    // treats ssl: "require" as rejectUnauthorized: false, which allows MitM).
    return { rejectUnauthorized: true };
  }

  if (sslMode === "verify-full" || sslMode === "verify-ca") {
    return { rejectUnauthorized: true };
  }
  if (sslMode === "require") return "require";
  return undefined;
}

function isPooledConnectionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("-pooler") || parsed.port === "6543";
  } catch {
    return false;
  }
}

function connectionString(): string {
  const url =
    /*
     * Prefer the pooled runtime URL when configured so concurrent serverless
     * instances do not exhaust direct Postgres `max_connections`. Falls back to
     * direct/unpooled URLs for single-string deployments. Migrations and CLI
     * scripts continue to prefer unpooled endpoints via `scripts/_lib.mjs`.
     */
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL || // set automatically by Vercel Postgres / Neon integrations
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    "";

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your PostgreSQL database, e.g.\n" +
        "  postgresql://user:password@host/dbname?sslmode=verify-full",
    );
  }
  return url;
}

function createClient(): Client {
  const url = connectionString();
  const ssl = resolveSslOption(url);
  const pooled = isPooledConnectionUrl(url);

  return postgres(url, {
    // Allow a small concurrent pool on serverless (e.g. dashboard Promise.all bursts)
    // without exhausting Postgres backends.
    max: process.env.VERCEL ? 3 : 10,
    idle_timeout: 20,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
    // Transaction-mode poolers (Supabase :6543, Neon -pooler) cannot use named
    // prepared statements.
    prepare: false,
    ...(ssl !== undefined ? { ssl } : {}),
    // Transaction poolers (PgBouncer/Neon) reject or drop startup options; apply
    // them on direct connections and keep statement_timeout aligned with 60s exports.
    ...(!pooled
      ? {
          connection: {
            search_path: "public",
            statement_timeout: 55000,
            idle_in_transaction_session_timeout: 15000,
          },
        }
      : {}),
    onnotice: () => {},
  });
}

// Next.js re-evaluates modules on every hot reload in development; cache the
// client on globalThis so we never open more connections than intended.
const globalForDb = globalThis as unknown as { __iicaSql?: Client };

function client(): Client {
  globalForDb.__iicaSql ??= createClient();
  return globalForDb.__iicaSql;
}

/**
 * Connecting is deferred until the first query. Building the app therefore does
 * not need a reachable database - or even DATABASE_URL - which matters because
 * Next.js imports every route module while collecting page configuration.
 */
export const sql: Client = new Proxy((() => {}) as unknown as Client, {
  apply(_target, _thisArg, args: unknown[]) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, property) {
    const value = Reflect.get(client(), property);
    return typeof value === "function" ? value.bind(client()) : value;
  },
});
