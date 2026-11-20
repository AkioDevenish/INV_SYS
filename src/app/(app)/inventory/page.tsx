import Link from "next/link";
import { Suspense } from "react";
import { PackageSearch } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  conditionCounts,
  countFilteredItems,
  countItems,
  countMovements,
  listCategories,
  listItems,
  listLocations,
  sumFilteredItemsValue,
  FILLING_CABINET_LOCATION_NAMES,
  CABI_LOCATION_NAME,
  type ItemFilters,
} from "@/lib/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { InventoryTabs } from "./inventory-tabs";
import { ExportDialog } from "@/components/export-dialog";
import { exportDatasetsFor } from "@/lib/export-datasets";
import { InventoryFilters } from "./filters";
import { NewItemButton } from "./item-form";
import { ImportItemsButton } from "./import-form";
import { InventoryList } from "./inventory-list";
import { isCondition, isRetiredCondition } from "@/lib/conditions";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "Inventory" };

const PER_PAGE = 20;
const MAX_PG_INT = 2_147_483_647;
const STOCK_OPTIONS = ["all", "low", "out", "attention"] as const;
const SORT_OPTIONS = ["name", "quantity", "value", "updated"] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PG_INT ? n : undefined;
}

export default async function InventoryPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePermission("inventory.view");
  const [params, canManage, canViewReports, categories, locations, exportDatasets] =
    await Promise.all([
      searchParams,
      can(user.role, "inventory.manage"),
      can(user.role, "reports.view"),
      listCategories(),
      listLocations(),
      exportDatasetsFor(user.role, ["inventory"]),
    ]);

  const requestedPage = positiveInt(one(params.page)) ?? 1;
  const categoryId = positiveInt(one(params.category));
  const locationId = positiveInt(one(params.location));
  const search = one(params.q)?.trim() || undefined;

  const rawStock = one(params.stock);
  const stock: NonNullable<ItemFilters["stock"]> =
    rawStock && (STOCK_OPTIONS as readonly string[]).includes(rawStock)
      ? (rawStock as NonNullable<ItemFilters["stock"]>)
      : "all";

  const rawSort = one(params.sort);
  const sort: NonNullable<ItemFilters["sort"]> =
    rawSort && (SORT_OPTIONS as readonly string[]).includes(rawSort)
      ? (rawSort as NonNullable<ItemFilters["sort"]>)
      : "name";

  const rawCondition = one(params.condition);
  const condition =
    rawCondition === "flagged" || rawCondition === "retired" || isCondition(rawCondition)
      ? rawCondition
      : undefined;

  const itCategoryId = categories.find(
    (category) => category.name.toLowerCase() === "it equipment",
  )?.id;
  const onItTab = itCategoryId !== undefined && categoryId === itCategoryId;
  const requestedGroup = one(params.locationGroup);
  const explicitGroup =
    requestedGroup === "all" ||
    requestedGroup === "iica" ||
    requestedGroup === "filling-cabinet" ||
    requestedGroup === "cabi"
      ? requestedGroup
      : undefined;

  // Cross-cutting filters (Dashboard / Taxonomy drill-downs by category, stock,
  // sort, condition, location, or search) span the entire catalogue unless a
  // specific locationGroup tab was explicitly selected.
  const hasCrossCuttingFilter = Boolean(
    locationId || categoryId || condition || stock !== "all" || sort !== "name" || search,
  );
  const locationGroup: ItemFilters["locationGroup"] =
    explicitGroup === "all"
      ? undefined
      : explicitGroup
        ? explicitGroup
        : hasCrossCuttingFilter
          ? undefined
          : "iica";

  const filters: ItemFilters = {
    search,
    categoryId,
    locationId,
    stock,
    condition,
    locationGroup,
    sort,
  };

  const tabConditionScope: Omit<ItemFilters, "condition" | "page" | "perPage" | "sort"> = {
    locationGroup,
    categoryId: onItTab ? itCategoryId : undefined,
  };

  const viewingOnlyRetired = condition === "retired" || isRetiredCondition(condition);

  const [
    allItemsCount,
    itemCount,
    filteredCount,
    totalValue,
    movementCount,
    conditions,
    fillingCabinetCount,
    cabiCount,
    itItemsCount,
  ] = await Promise.all([
    countItems(),
    countFilteredItems({ locationGroup: "iica" }),
    countFilteredItems(filters),
    canViewReports && !viewingOnlyRetired ? sumFilteredItemsValue(filters) : Promise.resolve(0),
    countMovements(),
    conditionCounts(tabConditionScope),
    countFilteredItems({ locationGroup: "filling-cabinet" }),
    countFilteredItems({ locationGroup: "cabi" }),
    itCategoryId !== undefined
      ? countFilteredItems({ categoryId: itCategoryId })
      : Promise.resolve(0),
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredCount / PER_PAGE));
  const currentPage = Math.min(requestedPage, pageCount);
  const items = await listItems({ ...filters, page: currentPage, perPage: PER_PAGE });

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const locationOptions = locations.map((l) => ({ id: l.id, name: l.name }));
  const cabinetShelfOrder = new Map<string, number>(
    FILLING_CABINET_LOCATION_NAMES.map((name, idx) => [name.toLowerCase(), idx]),
  );
  const cabiLower = CABI_LOCATION_NAME.toLowerCase();

  const filterLocations =
    locationGroup === "filling-cabinet"
      ? locations
          .filter((l) => l.id === locationId || cabinetShelfOrder.has(l.name.toLowerCase()))
          .sort(
            (a, b) =>
              (cabinetShelfOrder.get(a.name.toLowerCase()) ?? 99) -
              (cabinetShelfOrder.get(b.name.toLowerCase()) ?? 99),
          )
      : locationGroup === "cabi"
        ? locations.filter((l) => l.id === locationId || l.name.toLowerCase() === cabiLower)
        : locationGroup === "iica"
          ? locations.filter(
              (l) =>
                l.id === locationId ||
                (l.name.toLowerCase() !== cabiLower &&
                  !cabinetShelfOrder.has(l.name.toLowerCase())),
            )
          : locations;

  // On IICA Items, IT equipment has its own shortcut tab; everywhere else keep all categories selectable.
  const filterCategories =
    locationGroup === "iica"
      ? categoryOptions.filter((c) => c.id !== itCategoryId || c.id === categoryId)
      : categoryOptions;

  const canExport = exportDatasets.some((d) => d.allowed);

  const exportFilterParams: Record<string, string | undefined> = {
    q: filters.search,
    category: filters.categoryId ? String(filters.categoryId) : undefined,
    location: filters.locationId ? String(filters.locationId) : undefined,
    stock: filters.stock && filters.stock !== "all" ? filters.stock : undefined,
    condition: filters.condition,
    locationGroup: filters.locationGroup,
    sort: filters.sort && filters.sort !== "name" ? filters.sort : undefined,
  };

  const paginationParams: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    const single = one(value);
    if (single) paginationParams[key] = single;
  }

  const activeTab: "all" | "items" | "it-items" | "filling-cabinet" | "cabi" =
    explicitGroup === "filling-cabinet" || explicitGroup === "cabi"
      ? explicitGroup
      : explicitGroup === "iica"
        ? "items"
        : explicitGroup === "all"
          ? "all"
          : onItTab
            ? "it-items"
            : locationGroup === "iica"
              ? "items"
              : "all";

  const valuationDescription = !canViewReports
    ? undefined
    : viewingOnlyRetired
      ? "Retired assets are excluded from active stock valuation."
      : `Active stock valuation across selection: ${formatCurrency(totalValue)}`;

  return (
    <>
      <PageHeader
        eyebrow="Assets & supplies"
        title="Inventory"
        description="Office equipment, supplies and stock movements."
        actions={
          <>
            {canExport && (
              <ExportDialog
                datasets={exportDatasets}
                groups={[]}
                defaultDataset="inventory"
                filterParams={exportFilterParams}
                title="Export the inventory"
                description="Pick a format for the filtered item catalogue."
              />
            )}
            {canManage && <ImportItemsButton />}
            {canManage && (
              <NewItemButton
                categories={categoryOptions}
                locations={locationOptions}
              />
            )}
          </>
        }
      />

      <InventoryTabs
        active={activeTab}
        allItemsCount={allItemsCount}
        itemCount={itemCount}
        movementCount={movementCount}
        fillingCabinetCount={fillingCabinetCount}
        cabiCount={cabiCount}
        itItemsCount={itItemsCount}
        itCategoryId={itCategoryId}
      />

      <Suspense fallback={<div className="mb-4 h-10" />}>
        <InventoryFilters
          conditionCounts={conditions}
          categories={filterCategories}
          locations={filterLocations}
          hideCategory={onItTab}
          locationPlaceholder={
            locationGroup === "filling-cabinet" ? "All Shelves" : "All Locations"
          }
        />
      </Suspense>

      <div
        key={`${explicitGroup ?? "all"}-${categoryId ?? ""}-${condition ?? ""}-${currentPage}`}
        className="animate-fade"
      >
        <SectionCard
          title={`${formatNumber(filteredCount)} item${filteredCount === 1 ? "" : "s"}`}
          description={valuationDescription}
          bodyClassName="lg:overflow-x-auto"
          action={
            condition ? (
              <Link href="/inventory" className="text-xs font-medium text-iica-700 hover:underline">
                Back to IICA Items
              </Link>
            ) : undefined
          }
        >
          {items.length === 0 ? (
            <EmptyState
              icon={<PackageSearch size={20} />}
              title="Nothing matches those filters"
              description="Try a different search term, or clear the filters to see the whole catalogue."
            />
          ) : (
            <>
              <InventoryList
                items={items}
                categories={categoryOptions}
                locations={locationOptions}
                canManage={canManage}
              />
              <Pagination
                page={currentPage}
                perPage={PER_PAGE}
                total={filteredCount}
                basePath="/inventory"
                params={paginationParams}
              />
            </>
          )}
        </SectionCard>
      </div>
    </>
  );
}
