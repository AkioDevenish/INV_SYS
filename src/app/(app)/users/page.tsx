import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { exportDatasetsFor } from "@/lib/export-datasets";
import { listUsers } from "@/lib/queries";
import { getPermissionMatrix } from "@/lib/permissions";
import { ExportDialog } from "@/components/export-dialog";
import { PageHeader } from "@/components/ui";
import { NewUserButton } from "./user-forms";
import { UsersView } from "./users-view";

export const metadata = { title: "Users" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const admin = await requirePermission("users.manage", "/users");
  if ((await searchParams).tab === "access") redirect("/access");

  const [users, matrix, exportDatasets] = await Promise.all([
    listUsers(),
    getPermissionMatrix(),
    exportDatasetsFor(admin.role, ["users"]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Users & access"
        title="TT Delegation Users"
        description="Manage staff accounts, temporary passwords and sign-in status."
        actions={
          <>
            <Link href="/access" className="btn btn-ghost">
              <KeyRound size={15} /> Access
            </Link>
            <ExportDialog
              datasets={exportDatasets}
              groups={[]}
              defaultDataset="users"
              title="Export users"
              description="Download the user accounts list in Excel, CSV or JSON."
            />
            <NewUserButton />
          </>
        }
      />

      <UsersView
        users={users}
        currentUserId={admin.userId}
        matrix={matrix}
      />
    </>
  );
}
