import { requireUser } from "@/lib/auth";
import { PERMISSIONS, ROLE_DESCRIPTIONS } from "@/lib/roles";
import { getPermissionMatrix } from "@/lib/permissions";
import { canWith } from "@/lib/roles";
import { initials } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui";
import { PERMISSION_COPY } from "@/lib/permission-copy";
import { RoleBadge } from "@/components/role-badge";
import { DetailsForm, PasswordForm } from "./profile-forms";

export const metadata = { title: "Your profile" };


export default async function ProfilePage() {
  const user = await requireUser();
  const matrix = await getPermissionMatrix();
  const allowed = PERMISSIONS.filter((p) => canWith(matrix, user.role, p));

  return (
    <>
      <PageHeader eyebrow="Account" title="Your profile" />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <SectionCard title="Your details" bodyClassName="px-5 py-5">
            <DetailsForm name={user.name} email={user.email} />
          </SectionCard>

          <SectionCard
            title="Password"
            description="Choose something you do not use anywhere else"
            bodyClassName="px-5 py-5"
          >
            <PasswordForm />
          </SectionCard>
        </div>

        <div className="space-y-5">
          <div className="panel p-6 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-iica-500 to-iica-800 text-lg font-bold text-white">
              {initials(user.name)}
            </span>
            <div className="mt-4 text-base font-semibold text-ink">{user.name}</div>
            <div className="text-sm text-ink/60">{user.email}</div>
            <div className="mt-3 flex justify-center">
              <RoleBadge role={user.role} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink/60">
              {ROLE_DESCRIPTIONS[user.role]}
            </p>
          </div>

          <SectionCard
            title="What you can do"
            description="Granted by your access level"
            bodyClassName="divide-y divide-ink/5"
          >
            {allowed.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink/60">
                No workspace sections are currently granted to your role.
              </p>
            ) : (
              allowed.map((permission) => (
                <div key={permission} className="flex items-center gap-2.5 px-5 py-3 text-sm">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-iica-600" />
                  <span className="text-ink/75">{PERMISSION_COPY[permission].label}</span>
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
