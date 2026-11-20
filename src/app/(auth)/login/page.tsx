import { redirect } from "next/navigation";
import { ShieldCheck, Boxes, Users2, Users } from "lucide-react";
import { getCurrentUser, sanitizeNextPath } from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { needsSetup } from "@/lib/setup";
import { BrandLockup } from "@/components/brand";
import { ORG_SHORT } from "@/lib/brand";
import { LoginForm } from "./login-form";

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
  searchParams?: Promise<{ next?: string | string[] }>;
}) {
  if (await needsSetup()) redirect("/setup");

  const resolvedParams = searchParams ? await searchParams : {};
  const rawNext = Array.isArray(resolvedParams.next) ? resolvedParams.next[0] : resolvedParams.next;
  const nextPath = sanitizeNextPath(rawNext);

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

          <div className="mt-7">
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
