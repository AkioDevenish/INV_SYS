import Link from "next/link";
import { Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { listUsers } from "@/lib/queries";
import { getPermissionMatrix } from "@/lib/permissions";
import { ROLES, type Role } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { PermissionMatrixEditor } from "@/app/(app)/users/permission-matrix";

export const metadata = { title: "Access & permissions" };

export default async function AccessPage() {
  await requirePermission("users.manage", "/access");

  const [users, matrix] = await Promise.all([listUsers(), getPermissionMatrix()]);
  const roleUserCounts: Partial<Record<Role, number>> = {};
  for (const r of ROLES) roleUserCounts[r] = 0;
  for (const u of users) {
    roleUserCounts[u.role] = (roleUserCounts[u.role] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader
        eyebrow="Users & access"
        title="Access & permissions"
        description="Control what each role can view, edit and manage across the portal."
        actions={
          <Link href="/users" className="btn btn-ghost">
            <Users size={15} /> User accounts
          </Link>
        }
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-ink/8 px-4 py-3.5 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">What each access level can do</h2>
          <p className="mt-0.5 text-xs text-ink/60">
            Tick a box to grant a permission. Enforced on the server across all sections.
          </p>
        </div>
        <PermissionMatrixEditor
          matrix={matrix}
          editable
          roleUserCounts={roleUserCounts}
        />
      </div>
    </>
  );
}
