import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "@/lib/db";
import { getRequestClientInfo, recordAudit, sanitizeNextPath } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { MS_OAUTH_COOKIE, microsoftRedirectUri, microsoftSignInConfig } from "@/lib/microsoft";
import type { Role } from "@/lib/roles";

const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function fail(req: Request, code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  res.cookies.delete({ name: MS_OAUTH_COOKIE, path: "/api/auth/microsoft" });
  return res;
}

export async function GET(req: Request) {
  const cfg = microsoftSignInConfig();
  if (!cfg) return fail(req, "microsoft_off");

  const url = new URL(req.url);
  if (url.searchParams.get("error")) {
    // The person cancelled, or Microsoft refused (for example no consent).
    return fail(req, url.searchParams.get("error") === "access_denied" ? "microsoft_cancelled" : "microsoft_failed");
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${MS_OAUTH_COOKIE}=`))
    ?.slice(MS_OAUTH_COOKIE.length + 1);
  let saved: { state: string; nonce: string; verifier: string; next: string } | null = null;
  try {
    saved = raw ? JSON.parse(decodeURIComponent(raw)) : null;
  } catch {
    saved = null;
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!saved || !code || !state || !same(state, saved.state)) return fail(req, "microsoft_expired");

  // Exchange the code server-to-server; the client secret never reaches the browser.
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: microsoftRedirectUri(req),
        code_verifier: saved.verifier,
        scope: "openid profile email",
      }),
      cache: "no-store",
    },
  ).catch(() => null);
  const tokens = tokenRes ? ((await tokenRes.json().catch(() => ({}))) as { id_token?: string }) : {};
  if (!tokenRes?.ok || !tokens.id_token) return fail(req, "microsoft_failed");

  // Verify the ID token: Microsoft's signature, our client as audience, the
  // expected tenant as issuer, and the nonce from this sign-in.
  let claims: Record<string, unknown>;
  try {
    const keyTenant = GUID.test(cfg.tenantId) ? cfg.tenantId : "common";
    let jwks = jwksByTenant.get(keyTenant);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${keyTenant}/discovery/v2.0/keys`));
      jwksByTenant.set(keyTenant, jwks);
    }
    const { payload } = await jwtVerify(tokens.id_token, jwks, { audience: cfg.clientId });
    const tid = String(payload.tid ?? "");
    if (!GUID.test(tid) || payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new Error("issuer");
    if (GUID.test(cfg.tenantId) && tid.toLowerCase() !== cfg.tenantId.toLowerCase()) throw new Error("tenant");
    if (payload.nonce !== saved.nonce) throw new Error("nonce");
    claims = payload as Record<string, unknown>;
  } catch {
    return fail(req, "microsoft_failed");
  }

  const oid = String(claims.oid ?? "");
  const email = String(claims.email ?? claims.preferred_username ?? "")
    .trim()
    .toLowerCase();
  if (!oid || !email) return fail(req, "microsoft_failed");

  const { ip } = await getRequestClientInfo();

  // Match on the Microsoft account id first, then on email for a first sign-in.
  const [user] = await sql<
    {
      id: number;
      name: string;
      email: string;
      role: Role;
      status: string;
      must_change_password: boolean;
      token_version: number;
      microsoft_oid: string | null;
    }[]
  >`
    SELECT id, name, email, role, status, must_change_password, token_version, microsoft_oid
      FROM users
     WHERE microsoft_oid = ${oid} OR (microsoft_oid IS NULL AND lower(email) = ${email})
     ORDER BY (microsoft_oid = ${oid}) DESC NULLS LAST, id
     LIMIT 1`;

  if (!user) {
    await recordAudit({
      user: null,
      action: "SIGN_IN_FAILED",
      entity: "session",
      entityId: email.slice(0, 254),
      details: `Microsoft sign-in with no matching account | IP: ${ip}`,
    }).catch(() => {});
    return fail(req, "microsoft_no_account");
  }
  if (user.status !== "ACTIVE") {
    await recordAudit({
      user: null,
      action: "SIGN_IN_FAILED",
      entity: "session",
      entityId: email.slice(0, 254),
      details: `Microsoft sign-in to disabled account (user #${user.id}) | IP: ${ip}`,
    }).catch(() => {});
    return fail(req, "microsoft_disabled");
  }

  // First Microsoft sign-in: remember the account id. If the account was still
  // waiting on a first password change, retire that temporary password, since
  // Microsoft has now proved who this is.
  if (!user.microsoft_oid || user.must_change_password) {
    const unusable = user.must_change_password ? await hashPassword(randomBytes(32).toString("base64url")) : null;
    await sql`
      UPDATE users
         SET microsoft_oid = ${oid},
             must_change_password = false,
             password_hash = COALESCE(${unusable}, password_hash)
       WHERE id = ${user.id}`;
  }
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;

  const session = { userId: user.id, name: user.name, email: user.email, role: user.role, ver: user.token_version };
  await recordAudit({
    user: session,
    action: "SIGN_IN",
    entity: "session",
    entityId: user.id,
    details: `Microsoft${ip !== "unknown" ? ` | IP: ${ip}` : ""}`,
  });

  const matrix = await getPermissionMatrix();
  const target = sanitizeNextPath(saved.next) ?? defaultHomeForRole(matrix, user.role);
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(SESSION_COOKIE, await signSession(session), sessionCookieOptions);
  res.cookies.delete({ name: MS_OAUTH_COOKIE, path: "/api/auth/microsoft" });
  return res;
}
