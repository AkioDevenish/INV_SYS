import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, Lock } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRetiredCondition } from "@/lib/conditions";
import {
  countFilteredItems,
  countMovements,
  listCategories,
  listItems,
  listMovementsPage,
} from "@/lib/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { InventoryTabs } from "../inventory/inventory-tabs";
import { MovementTypeBadge } from "@/components/movement-badge";
import { Pagination } from "@/components/pagination";
import { Sku } from "@/components/sku";
import { MovementFilters } from "./filters";
import { MovementForm } from "./movement-form";

export const metadata = { title: "Stock movements" };

const PER_PAGE = 50;
const MAX_PG_INT = 2_147_483_647;
const MOVEMENT_TYPES = ["IN", "OUT", "ADJUST"] as const;

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

export default async function MovementsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePermission("inventory.view");
  const [params, canRecord, categories] = await Promise.all([
    searchParams,
    can(user.role, "movement.record"),
    listCategories(),
  ]);

  const requestedPage = positiveInt(one(params.page)) ?? 1;
  const itemFilterId = positiveInt(one(params.item));
  const rawType = one(params.type);
  const typeFilter =
    rawType && (MOVEMENT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as (typeof MOVEMENT_TYPES)[number])
      : undefined;
  const search = one(params.q)?.trim() || undefined;

  const itCategoryId = categories.find(
    (category) => category.name.toLowerCase() === "it equipment",
  )?.id;

  const [
    { rows: pageRows, total: filteredTotal },
    allItems,
    itemCount,
    movementCount,
    fillingCabinetCount,
    cabiCount,
    itItemsCount,
  ] = await Promise.all([
    listMovementsPage({
      search,
      type: typeFilter,
      itemId: itemFilterId,
      page: requestedPage,
      perPage: PER_PAGE,
    }),
    listItems({ sort: "name" }),
    countFilteredItems({ locationGroup: "iica" }),
    countMovements(),
    countFilteredItems({ locationGroup: "filling-cabinet" }),
    countFilteredItems({ locationGroup: "cabi" }),
    itCategoryId !== undefined
      ? countFilteredItems({ categoryId: itCategoryId })
      : Promise.resolve(0),
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredTotal / PER_PAGE));
  const currentPage = Math.min(requestedPage, pageCount);
  const movements =
    currentPage === requestedPage
      ? pageRows
      : (
          await listMovementsPage({
            search,
            type: typeFilter,
            itemId: itemFilterId,
            page: currentPage,
            perPage: PER_PAGE,
          })
        ).rows;

  const activeItems = canRecord
    ? allItems
        .filter((i) => !isRetiredCondition(i.condition))
        .map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          quantity: i.quantity,
          unit: i.unit,
          location_name: i.location_name,
          condition: i.condition,
        }))
    : [];

  const filterItemOptions = allItems.map((i) => ({ id: i.id, name: i.name }));

  const paginationParams: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    const single = one(value);
    if (single) paginationParams[key] = single;
  }

  return (
    <>
      <PageHeader
        eyebrow="Assets & supplies"
        title="Inventory"
        description="Office equipment, supplies and stock movements."
      />

      <InventoryTabs
        active="movements"
        itemCount={itemCount}
        movementCount={movementCount}
        fillingCabinetCount={fillingCabinetCount}
        cabiCount={cabiCount}
        itItemsCount={itItemsCount}
        itCategoryId={itCategoryId}
      />

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="xl:sticky xl:top-6 xl:self-start">
          <SectionCard
            title="Record a movement"
            description="Updates the item balance immediately"
            bodyClassName="px-5 py-5"
          >
            {canRecord ? (
              activeItems.length === 0 ? (
                <EmptyState
                  title="No active items available"
                  description="Add an in-service item to the catalogue before recording movements."
                />
              ) : (
                <MovementForm items={activeItems} />
              )
            ) : (
              <EmptyState
                icon={<Lock size={20} />}
                title="Read-only access"
                description="Your role can view the movement history but not record new movements."
              />
            )}
          </SectionCard>
        </div>

        <div className="min-w-0">
          <Suspense fallback={<div className="mb-4 h-10" />}>
            <MovementFilters items={filterItemOptions} />
          </Suspense>

          <SectionCard
            title="History"
            description={
              filteredTotal === movementCount
                ? `${formatNumber(filteredTotal)} recorded movement${filteredTotal === 1 ? "" : "s"}`
                : `${formatNumber(filteredTotal)} matching movement${filteredTotal === 1 ? "" : "s"} (${formatNumber(movementCount)} total)`
            }
            bodyClassName="lg:overflow-x-auto"
          >
            {movements.length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight size={20} />}
                title={movementCount === 0 ? "No movements yet" : "Nothing matches those filters"}
                description={
                  movementCount === 0
                    ? "Once stock starts moving, the full history appears here."
                    : "Try a different search term or clear your filters."
                }
              />
            ) : (
              <>
                {/* Card per movement below lg - the seven-column history is
                    unreadable on a handset. */}
                <ul className="divide-y divide-ink/8 lg:hidden">
                  {movements.map((m) => (
                    <li key={m.id} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/inventory/${m.item_id}`}
                            className="font-medium text-ink hover:text-iica-700"
                          >
                            {m.item_name}
                          </Link>
                          <Sku sku={m.item_sku} className="block text-xs text-ink/60" />
                        </div>
                        <div className="shrink-0 text-right">
                          <div
                            className={`font-semibold tabular-nums ${
                              m.quantity < 0 || m.type === "OUT" ? "text-gold-700" : "text-iica-700"
                            }`}
                          >
                            {m.type === "OUT" ? "−" : m.quantity < 0 ? "−" : "+"}
                            {formatNumber(Math.abs(m.quantity))}
                          </div>
                          <div className="text-xs text-ink/60">
                            balance {formatNumber(m.balance_after)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink/65">
                        <MovementTypeBadge type={m.type} withLabel />
                        <span>{m.user_name ?? "Removed user"}</span>
                        <span>{formatDateTime(m.created_at)}</span>
                      </div>
                      {m.note && <div className="mt-1.5 text-xs text-ink/65">{m.note}</div>}
                    </li>
                  ))}
                </ul>

                <table className="table-shell hidden min-w-[720px] lg:table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Item</th>
                      <th className="text-right">Change</th>
                      <th className="text-right">Balance</th>
                      <th>Recorded by</th>
                      <th>Note</th>
                      <th className="text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <MovementTypeBadge type={m.type} withLabel />
                        </td>
                        <td>
                          <Link
                            href={`/inventory/${m.item_id}`}
                            className="font-medium text-ink hover:text-iica-700"
                          >
                            {m.item_name}
                          </Link>
                          <Sku sku={m.item_sku} className="block text-xs text-ink/60" />
                        </td>
                        <td
                          className={`text-right font-semibold tabular-nums ${
                            m.quantity < 0 || m.type === "OUT" ? "text-gold-700" : "text-iica-700"
                          }`}
                        >
                          {m.type === "OUT" ? "−" : m.quantity < 0 ? "−" : "+"}
                          {formatNumber(Math.abs(m.quantity))}
                        </td>
                        <td className="text-right tabular-nums text-ink/75">
                          {formatNumber(m.balance_after)}
                        </td>
                        <td className="text-ink/70">{m.user_name ?? "Removed user"}</td>
                        <td className="max-w-[220px] truncate text-ink/60">{m.note ?? "-"}</td>
                        <td className="whitespace-nowrap text-right text-xs text-ink/60">
                          {formatDateTime(m.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination
                  page={currentPage}
                  perPage={PER_PAGE}
                  total={filteredTotal}
                  basePath="/movements"
                  params={paginationParams}
                />
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
