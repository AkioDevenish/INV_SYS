import "server-only";

/**
 * Microsoft 365 for the app: sending mail through Microsoft Graph and the
 * Entra ID (Azure AD) settings used by "Sign in with Microsoft".
 *
 * Both use the app registration already configured for SharePoint sync:
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
 * Mail also needs MAIL_FROM, the mailbox reminders are sent from, and the
 * registration needs the Mail.Send application permission (admin consent).
 * Sign-in needs <app URL>/api/auth/microsoft/callback added as a Web redirect
 * URI on the same registration.
 */

type AppConfig = { tenantId: string; clientId: string; clientSecret: string };

function appConfig(): AppConfig | null {
  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export function microsoftSignInConfig(): AppConfig | null {
  return appConfig();
}

export function isMicrosoftSignInEnabled(): boolean {
  return appConfig() !== null;
}

export function mailFrom(): string | null {
  const from = process.env.MAIL_FROM?.trim();
  return from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ? from : null;
}

export function isMailConfigured(): boolean {
  return appConfig() !== null && mailFrom() !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function graphAppToken(cfg: AppConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
      cache: "no-store",
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description?.split("\n")[0] || `Token request failed (${res.status}).`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3000) * 1000 };
  return data.access_token;
}

export type MailResult = { ok: true } | { ok: false; error: string; notConfigured?: boolean };

/** Sends one HTML email from MAIL_FROM. Never throws. */
export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<MailResult> {
  const cfg = appConfig();
  const from = mailFrom();
  if (!cfg || !from) {
    return {
      ok: false,
      notConfigured: true,
      error: "Email isn't set up yet. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MAIL_FROM.",
    };
  }
  try {
    const token = await graphAppToken(cfg);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: "HTML", content: input.html },
          toRecipients: [{ emailAddress: { address: input.to } }],
        },
        saveToSentItems: false,
      }),
      cache: "no-store",
    });
    if (res.status === 202 || res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: body.error?.message ?? `Microsoft Graph returned ${res.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed." };
  }
}

/* ---------- sign-in helpers ---------- */

export const MS_OAUTH_COOKIE = "iica_ms_oauth";

/** Where Microsoft should send people back to: APP_URL if set, else this request's origin. */
export function appOrigin(req: Request): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  return new URL(req.url).origin;
}

export function microsoftRedirectUri(req: Request): string {
  return `${appOrigin(req)}/api/auth/microsoft/callback`;
}
