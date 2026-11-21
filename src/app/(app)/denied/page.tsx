import Link from "next/link";
import { Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PERMISSION_COPY } from "@/lib/permission-copy";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { ROLE_DESCRIPTIONS, isPermission } from "@/lib/roles";
import { RoleBadge } from "@/components/role-badge";

export const metadata = { title: "Access denied" };

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string | string[] }>;
}) {
  const user = await requireUser();
  const [matrix, rawParams] = await Promise.all([
    getPermissionMatrix(),
    searchParams,
  ]);
  const rawPerm = Array.isArray(rawParams.permission)
    ? rawParams.permission[0]
    : rawParams.permission;
  const activity =
    rawPerm && isPermission(rawPerm)
      ? PERMISSION_COPY[rawPerm].label.toLowerCase()
      : undefined;
  const homeHref = defaultHomeForRole(matrix, user.role);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-ink/10 bg-ink/[0.03] text-ink/50">
        <Lock size={22} />
      </span>
      <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
        You do not have access to this page
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink/60">
        {activity
          ? `Your access level does not include ${activity}.`
          : "Your access level does not include this part of the system."}{" "}
        Ask an administrator if you need it.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <span className="text-xs text-ink/55">Your level:</span>
        <RoleBadge role={user.role} />
      </div>
      <p className="mt-2 max-w-xs text-xs text-ink/55">{ROLE_DESCRIPTIONS[user.role]}</p>
      <Link href={homeHref} className="btn btn-primary mt-7">
        {homeHref === "/dashboard" ? "Back to the dashboard" : "Back to your workspace"}
      </Link>
    </div>
  );
}
