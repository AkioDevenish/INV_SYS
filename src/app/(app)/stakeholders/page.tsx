import { Suspense } from "react";
import { Users2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  listStakeholderGroups,
  listStakeholderPage,
  type StakeholderFilters,
} from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { ExportDialog } from "@/components/export-dialog";
import { exportDatasetsFor } from "@/lib/export-datasets";
import { StakeholderFilters as Filters } from "./filters";
import {
  NewStakeholderButton,
  StakeholderDirectoryList,
} from "./stakeholder-form";

export const metadata = { title: "Stakeholders" };

const PER_PAGE = 50;

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : undefined;
}

const VALID_HAS = new Set(["email", "phone", "nocontact"]);
const VALID_SORT = new Set(["name", "organisation", "group", "updated"]);

export default async function StakeholdersPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const user = await requirePermission("stakeholders.view");
  const [canManage, params] = await Promise.all([
    can(user.role, "stakeholders.manage"),
    searchParams,
  ]);

  const page = parsePositiveInt(one(params.page)) ?? 1;
  const groupParam = one(params.group);
  const hasParam = one(params.has);
  const sortParam = one(params.sort);
  const qParam = one(params.q);

  const parsedGroupId =
    groupParam && groupParam !== "ungrouped" ? parsePositiveInt(groupParam) : undefined;

  const filters: StakeholderFilters = {
    search: qParam || undefined,
    groupId: parsedGroupId,
    group: groupParam === "ungrouped" ? "ungrouped" : undefined,
    has: hasParam && VALID_HAS.has(hasParam) ? (hasParam as StakeholderFilters["has"]) : undefined,
    sort: sortParam && VALID_SORT.has(sortParam) ? (sortParam as StakeholderFilters["sort"]) : undefined,
  };

  // Issued together: the page of rows (which carries its own total), the group
  // list for the filter dropdown, and what this person may export.
  const [firstPage, groups, exportDatasets] = await Promise.all([
    listStakeholderPage({ ...filters, page, perPage: PER_PAGE }),
    listStakeholderGroups(),
    exportDatasetsFor(user.role, ["stakeholders"]),
  ]);

  // A narrowed filter can leave you past the end of the shorter result set.
  let people = firstPage.rows;
  let total = firstPage.total;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  if (currentPage !== page) {
    const clamped = await listStakeholderPage({ ...filters, page: currentPage, perPage: PER_PAGE });
    people = clamped.rows;
    total = clamped.total;
  }

  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const paginationParams: Record<string, string | undefined> = {
    q: qParam,
    group: groupParam,
    has: hasParam,
    sort: sortParam,
  };
  const exportFilterParams: Record<string, string | undefined> = {
    q: qParam || undefined,
    group:
      groupParam === "ungrouped"
        ? "ungrouped"
        : parsedGroupId
          ? String(parsedGroupId)
          : undefined,
    has: hasParam && VALID_HAS.has(hasParam) ? hasParam : undefined,
    sort: sortParam && VALID_SORT.has(sortParam) ? sortParam : undefined,
  };

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="TT Delegation Stakeholders"
        description="Ministries, partner agencies, producers and local organisations."
        actions={
          <>
            <ExportDialog
              datasets={exportDatasets}
              groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.item_count }))}
              defaultDataset="stakeholders"
              filterParams={exportFilterParams}
              title="Export the directory"
              description="Choose which groups to include and pick a format."
            />
            {canManage && <NewStakeholderButton groups={groupOptions} />}
          </>
        }
      />

      <Suspense fallback={<div className="mb-4 h-10" />}>
        <Filters groups={groups} />
      </Suspense>

      <SectionCard
        title={`${formatNumber(total)} contact${total === 1 ? "" : "s"}`}
        description="Select anyone to see their full record."
        bodyClassName="lg:overflow-x-auto"
      >
        {people.length === 0 ? (
          <EmptyState
            icon={<Users2 size={20} />}
            title="Nothing matches those filters"
            description="Try a different search term, or clear the filters to see the whole directory."
          />
        ) : (
          <>
            <StakeholderDirectoryList
              people={people}
              groups={groupOptions}
              canManage={canManage}
            />

            <Pagination
              page={currentPage}
              perPage={PER_PAGE}
              total={total}
              basePath="/stakeholders"
              params={paginationParams}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}
