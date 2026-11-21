import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { sanitizeNextPath } from "@/lib/auth";
import { MS_OAUTH_COOKIE, microsoftRedirectUri, microsoftSignInConfig } from "@/lib/microsoft";

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Starts "Sign in with Microsoft": authorization code flow with PKCE, a state
 * value against cross-site requests and a nonce bound into the ID token.
 */
export async function GET(req: Request) {
  const cfg = microsoftSignInConfig();
  const url = new URL(req.url);
  if (!cfg) return NextResponse.redirect(new URL("/login?error=microsoft_off", url));

  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const next = sanitizeNextPath(url.searchParams.get("next")) ?? "";

  const authorize = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`,
  );
  authorize.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: microsoftRedirectUri(req),
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const res = NextResponse.redirect(authorize);
  res.cookies.set(MS_OAUTH_COOKIE, JSON.stringify({ state, nonce, verifier, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/microsoft",
    maxAge: 600,
  });
  return res;
}
