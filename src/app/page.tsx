import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";
import { needsSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (await needsSetup()) redirect("/setup");

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  const matrix = await getPermissionMatrix();
  redirect(defaultHomeForRole(matrix, user.role));
}
