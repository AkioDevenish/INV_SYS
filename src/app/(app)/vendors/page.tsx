import { Suspense } from "react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listUsers } from "@/lib/queries";
import { trinidadTodayKey } from "@/lib/vendor-groups";
import { listVendorsWithStats } from "@/lib/vendors";
import { PageHeader } from "@/components/ui";
import {
  ExportVendorsButton,
  ImportVendorsButton,
  LogEngagementButton,
  NewVendorButton,
  type VendorSelectOption,
} from "./vendor-form";
import { VendorsView } from "./vendors-view";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await requirePermission("vendors.view");
  const [canManage, canViewReports] = await Promise.all([
    can(user.role, "vendors.manage"),
    can(user.role, "reports.view"),
  ]);

  const [{ vendors, engagements }, users] = await Promise.all([
    listVendorsWithStats(),
    canManage ? listUsers() : Promise.resolve([]),
  ]);

  const todayKey = trinidadTodayKey();

  const staffNames = canManage
    ? users.filter((u) => u.status === "ACTIVE").map((u) => u.name)
    : [];

  // Strip currency figures from the RSC payload unless the user holds reports.view.
  const safeVendors = canViewReports
    ? vendors
    : vendors.map((v) => ({
        ...v,
        estimated_cost: null,
        standard_cost: null,
        total_spend_ttd: 0,
        pending_spend_ttd: 0,
        quoted_ttd: 0,
      }));

  const safeEngagements = canViewReports
    ? engagements
    : engagements.map((e) => ({
        ...e,
        estimated_cost_ttd: null,
        amount_ttd: null,
      }));

  const vendorOptions: VendorSelectOption[] = safeVendors.map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    status: v.status,
    billing_cycle: v.billing_cycle,
    next_due_date: v.next_due_date,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="TT Delegation Vendors"
        description="Approved suppliers, recurring utilities, maintenance contracts and spend history."
        actions={
          <>
            <ExportVendorsButton canViewReports={canViewReports} />
            {canManage && <ImportVendorsButton />}
            {canManage && (
              <LogEngagementButton
                vendors={vendorOptions}
                staffNames={staffNames}
                canViewReports={canViewReports}
                todayKey={todayKey}
              />
            )}
            {canManage && <NewVendorButton canViewReports={canViewReports} />}
          </>
        }
      />

      <Suspense fallback={<div className="panel h-96 animate-pulse" />}>
        <VendorsView
          vendors={safeVendors}
          engagements={safeEngagements}
          canManage={canManage}
          canViewReports={canViewReports}
          staffNames={staffNames}
          todayKey={todayKey}
        />
      </Suspense>
    </>
  );
}
