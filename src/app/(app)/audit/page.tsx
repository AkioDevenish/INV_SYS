import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { exportDatasetsFor } from "@/lib/export-datasets";
import {
  AUDIT_CATEGORIES,
  AUDIT_MODULES,
  auditCategoryCounts,
  listAuditPage,
} from "@/lib/queries";
import { ExportDialog } from "@/components/export-dialog";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { AuditView, type SerializedAuditLog } from "./audit-view";
import { AuditFilters } from "./filters";

export const metadata = { title: "Audit trail" };

const PER_PAGE = 25;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("audit.view");
  const rawParams = await searchParams;
  const cleanParams: Record<string, string | undefined> = {
    q: one(rawParams.q),
    category: one(rawParams.category),
    module: one(rawParams.module),
    page: one(rawParams.page),
  };

  const parsedPage = Number(cleanParams.page);
  const requestedPage =
    Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1_000_000 ? parsedPage : 1;
  const search = cleanParams.q?.trim() || undefined;
  const moduleKey =
    cleanParams.module && cleanParams.module in AUDIT_MODULES ? cleanParams.module : undefined;
  const categoryKey =
    cleanParams.category && cleanParams.category in AUDIT_CATEGORIES
      ? cleanParams.category
      : undefined;

  const [initialResult, counts, exportDatasets] = await Promise.all([
    listAuditPage({
      search,
      category: categoryKey,
      module: moduleKey,
      page: requestedPage,
      perPage: PER_PAGE,
    }),
    auditCategoryCounts(search, moduleKey),
    exportDatasetsFor(user.role, ["audit"]),
  ]);

  let page = requestedPage;
  let logs = initialResult.rows;
  let total = initialResult.total;

  // Clamp out-of-range page requests so existing results are not hidden behind an empty state.
  if (logs.length === 0 && page > 1) {
    const knownTotal = total > 0 ? total : categoryKey ? (counts[categoryKey] ?? 0) : counts.all;
    if (knownTotal > 0) {
      const lastPage = Math.max(1, Math.ceil(knownTotal / PER_PAGE));
      const clamped = await listAuditPage({
        search,
        category: categoryKey,
        module: moduleKey,
        page: lastPage,
        perPage: PER_PAGE,
      });
      page = lastPage;
      logs = clamped.rows;
      total = Math.max(clamped.total, knownTotal);
    } else {
      page = 1;
    }
  }

  const categories = Object.entries(AUDIT_CATEGORIES).map(([key, v]) => ({
    key,
    label: v.label,
    count: counts[key] ?? 0,
  }));

  const modules = Object.entries(AUDIT_MODULES).map(([key, v]) => ({
    key,
    label: v.label,
  }));

  const serializedLogs: SerializedAuditLog[] = logs.map((log) => ({
    ...log,
    created_at:
      log.created_at instanceof Date ? log.created_at.toISOString() : String(log.created_at),
  }));

  const filterKey = `${categoryKey ?? "all"}-${moduleKey ?? "all"}-${search ?? ""}-${page}`;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="TT Delegation Audit Trail"
        description="Append-only activity log across inventory, vendors, calendar, stakeholders and accounts."
        actions={
          <ExportDialog
            datasets={exportDatasets}
            groups={[]}
            defaultDataset="audit"
            title="Export audit trail"
            description="Download the recorded audit trail in Excel, CSV or JSON."
          />
        }
      />

      <Suspense fallback={<div className="mb-4 h-14" />}>
        <AuditFilters categories={categories} modules={modules} total={counts.all} />
      </Suspense>

      {serializedLogs.length === 0 ? (
        <SectionCard title="Nothing to show" description="No entries match those filters.">
          <EmptyState
            icon={<ShieldCheck size={20} />}
            title="Nothing recorded here yet"
            description="Try a different category, module or clear the search."
          />
        </SectionCard>
      ) : (
        <AuditView
          logs={serializedLogs}
          total={total}
          filterKey={filterKey}
          pagination={
            <Pagination
              page={page}
              perPage={PER_PAGE}
              total={total}
              basePath="/audit"
              params={cleanParams}
            />
          }
        />
      )}
    </>
  );
}
