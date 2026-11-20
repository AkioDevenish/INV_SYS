import { requireUser } from "@/lib/auth";
import { getPermissionMatrix } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { NAV_SECTIONS, canViewNavItem } from "@/components/nav-config";
import { logoutAction } from "../(auth)/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // One read for the whole sidebar rather than one per nav item.
  const matrix = await getPermissionMatrix();
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canViewNavItem(matrix, user.role, item)),
  })).filter((section) => section.items.length > 0);

  return (
    <AppShell
      sections={sections}
      user={{ name: user.name, role: user.role }}
      logout={logoutAction}
    >
      {children}
    </AppShell>
  );
}
