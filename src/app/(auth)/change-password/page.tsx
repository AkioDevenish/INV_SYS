import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { BrandLockup } from "@/components/brand";
import { logoutAction } from "../login/actions";
import { ChangePasswordForm } from "./change-form";

export const metadata = { title: "Choose a password" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Nobody reaches this screen unless they are actually on a temporary password.
  if (!user.mustChangePassword) {
    const matrix = await getPermissionMatrix();
    redirect(defaultHomeForRole(matrix, user.role));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <section className="animate-rise panel p-7 sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <BrandLockup />
          <form action={logoutAction}>
            <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </div>
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-gold-600/35 bg-gold-400/15 px-3 py-2.5 text-sm text-gold-700">
          <KeyRound size={16} className="mt-0.5 shrink-0" />
          <p>
            Your account was created with a temporary password. Choose your own before you
            continue - nobody else knows it, including the administrator who set it up.
          </p>
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
          Choose your password
        </h1>
        <p className="mt-1.5 text-sm text-ink/55">Signed in as {user.email}</p>

        <div className="mt-6">
          <ChangePasswordForm />
        </div>
      </section>
    </main>
  );
}
