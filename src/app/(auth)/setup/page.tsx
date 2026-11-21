import { redirect } from "next/navigation";
import { Database, KeyRound, ShieldCheck } from "lucide-react";
import { needsSetup } from "@/lib/setup";
import { BrandLockup } from "@/components/brand";
import { SetupForm } from "./setup-form";

export const metadata = { title: "First-run setup" };
export const dynamic = "force-dynamic";

const steps = [
  {
    icon: Database,
    title: "Your database is ready",
    body: "The tables were created automatically the first time this page loaded.",
  },
  {
    icon: KeyRound,
    title: "Create the first administrator",
    body: "This account has full control, including creating everyone else's.",
  },
  {
    icon: ShieldCheck,
    title: "This page then locks itself",
    body: "Once an account exists, setup can never be run again.",
  },
];

export default async function SetupPage() {
  // Anyone can reach this URL - it only does anything while the system is empty.
  if (!(await needsSetup())) redirect("/login");
  const requireSetupToken = Boolean(process.env.SETUP_TOKEN?.trim());

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-5 py-10">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_minmax(0,420px)]">
        <section className="animate-rise hidden lg:block">
          <BrandLockup />
          <h1 className="mt-10 text-[2.85rem] font-semibold leading-[1.08] tracking-tight text-ink">
            Let&apos;s get you
            <br />
            <span className="bg-gradient-to-r from-iica-800 via-iica-600 to-gold-600 bg-clip-text text-transparent">
              set up.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink/55">
            This system has no accounts yet. Create the administrator account and you will be
            signed straight in - no command line, no configuration files.
          </p>

          <ul className="mt-10 space-y-4">
            {steps.map(({ icon: Icon, title, body }) => (
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
          <div className="mt-6 lg:mt-0">
            <span className="chip border-iica-500/30 bg-iica-600/10 text-iica-700">
              First-run setup
            </span>
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
            Create your administrator account
          </h2>
          <p className="mt-1.5 text-sm text-ink/45">
            You will be signed in as soon as this is done.
          </p>

          <div className="mt-7">
            <SetupForm requireSetupToken={requireSetupToken} />
          </div>

          <p className="mt-7 border-t border-ink/8 pt-5 text-xs leading-relaxed text-ink/40">
            Choose a password you do not use anywhere else. You can add colleagues, and decide how
            much each of them can see, from the Users screen afterwards.
          </p>
        </section>
      </div>
    </main>
  );
}
