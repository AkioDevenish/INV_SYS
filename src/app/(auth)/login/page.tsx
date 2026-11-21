import { redirect } from "next/navigation";
import { ShieldCheck, Boxes, Users2, Users } from "lucide-react";
import { getCurrentUser, sanitizeNextPath } from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { needsSetup } from "@/lib/setup";
import { BrandLockup } from "@/components/brand";
import { ORG_SHORT } from "@/lib/brand";
import { LoginForm } from "./login-form";
import { isMicrosoftSignInEnabled } from "@/lib/microsoft";

const MICROSOFT_ERRORS: Record<string, string> = {
  microsoft_off: "Microsoft sign-in isn't set up on this server yet. Use your password.",
  microsoft_cancelled: "Microsoft sign-in was cancelled.",
  microsoft_expired: "That sign-in took too long or was opened in another tab. Please try again.",
  microsoft_failed: "Microsoft sign-in didn't complete. Please try again, or use your password.",
  microsoft_no_account:
    "Your Microsoft account isn't linked to an account here. Ask an administrator to add you using your work email.",
  microsoft_disabled: "This account has been disabled. Contact an administrator.",
};

/** The four-square Microsoft mark, drawn inline so the CSP never has to allow an outside image. */
function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const highlights = [
  {
    icon: Boxes,
    title: "One catalogue",
    body: "Assets, equipment and supplies tracked by SKU, location, condition and value.",
  },
  {
    icon: Users2,
    title: "Stakeholder directory",
    body: "Ministries, partners, producers and businesses, all searchable, grouped and exportable.",
  },
  {
    icon: Users,
    title: "Role-based access",
    body: "Every account sees only what its role allows, and every change is attributable.",
  },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  if (await needsSetup()) redirect("/setup");

  const resolvedParams = searchParams ? await searchParams : {};
  const rawNext = Array.isArray(resolvedParams.next) ? resolvedParams.next[0] : resolvedParams.next;
  const nextPath = sanitizeNextPath(rawNext);
  const rawError = Array.isArray(resolvedParams.error) ? resolvedParams.error[0] : resolvedParams.error;
  const microsoftError = rawError ? MICROSOFT_ERRORS[rawError] : undefined;
  const microsoftEnabled = isMicrosoftSignInEnabled();

  const user = await getCurrentUser();
  if (user) {
    if (user.mustChangePassword) redirect("/change-password");
    const matrix = await getPermissionMatrix();
    redirect(nextPath ?? defaultHomeForRole(matrix, user.role));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-5 py-10">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_minmax(0,420px)]">
        <section className="animate-rise hidden lg:block">
          <BrandLockup />
          <h1 className="mt-10 text-[2.85rem] font-semibold leading-[1.08] tracking-tight text-ink">
            Everything the delegation
            <br />
            <span className="bg-gradient-to-r from-iica-800 via-iica-600 to-gold-600 bg-clip-text text-transparent">
              owns, and everyone it works with.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink/55">
            The internal record for the {ORG_SHORT} delegation. Every asset, supply and stakeholder
            held in one place, hosted by the office itself, with no licences and no per-seat fees.
          </p>

          <ul className="mt-10 space-y-4">
            {highlights.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-iica-600/25 bg-iica-600/10 text-iica-700">
                  <Icon size={17} />
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink">{title}</div>
                  <div className="text-sm text-ink/50">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="animate-rise panel p-7 sm:p-8">
          <div className="lg:hidden">
            <BrandLockup />
          </div>
          <h2 className="mt-6 text-xl font-semibold tracking-tight text-ink lg:mt-0">
            Sign in to continue
          </h2>
          <p className="mt-1.5 text-sm text-ink/55">
            Use the account issued to you by your {ORG_SHORT} administrator.
          </p>

          {microsoftError && (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
            >
              {microsoftError}
            </div>
          )}

          {microsoftEnabled && (
            <>
              <a
                href={`/api/auth/microsoft/start${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
                className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-xs transition hover:border-iica-300 hover:bg-iica-50/40"
              >
                <MicrosoftLogo />
                Sign in with Microsoft
              </a>
              <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink/40">
                <span className="h-px flex-1 bg-ink/10" />
                or use a password
                <span className="h-px flex-1 bg-ink/10" />
              </div>
            </>
          )}

          <div className={microsoftEnabled ? "" : "mt-7"}>
            <LoginForm nextPath={nextPath ?? undefined} />
          </div>

          <div className="mt-7 flex items-start gap-2.5 border-t border-ink/8 pt-5 text-xs leading-relaxed text-ink/65">
            <ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-iica-700" />
            <p>
              Sessions are cryptographically signed and expire after 8 hours. Every sign-in and
              every stock change is written to the audit trail. If you have lost your password, an
              administrator can reset it for you.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
