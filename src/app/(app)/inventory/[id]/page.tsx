import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, Lock } from "lucide-react";
import { getCurrentUser, requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getItem,
  listCategories,
  listLocations,
  listMovementsPage,
} from "@/lib/queries";
import { formatCurrency, formatDateTime, formatNumber, formatUnits } from "@/lib/format";
import { EmptyState, PageHeader, SectionCard, StatCard, StockPill } from "@/components/ui";
import {
  CONDITION_META,
  isAssignedAsset,
  isRetiredCondition,
  isStockStorageLocation,
} from "@/lib/conditions";
import { MovementTypeBadge } from "@/components/movement-badge";
import { Pagination } from "@/components/pagination";
import { MovementForm } from "../../movements/movement-form";
import { EditItemButton } from "../item-form";
import { DeleteItemButton } from "./delete-item";
import { displaySku, isPlaceholderSku } from "@/lib/sku";

const MOVEMENTS_PER_PAGE = 25;
const MAX_PG_INT = 2_147_483_647;

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

function positiveInt(raw: string | string[] | undefined): number | undefined {
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (!single) return undefined;
  const trimmed = single.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PG_INT ? n : undefined;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const numId = positiveInt(id);
  if (!numId) return { title: "Item" };

  const user = await getCurrentUser();
  if (!user || user.mustChangePassword || !(await can(user.role, "inventory.view"))) {
    return { title: "Item" };
  }

  const item = await getItem(numId);
  return { title: item?.name ?? "Item" };
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const numId = positiveInt(id);
  if (!numId) notFound();

  const [item, sp, canManage, canRecord] = await Promise.all([
    getItem(numId),
    searchParams,
    can(user.role, "inventory.manage"),
    can(user.role, "movement.record"),
  ]);
  if (!item) notFound();

  const requestedPage = positiveInt(sp.page) ?? 1;
  const [{ rows: movements, total: totalMovements }, categories, locations] = await Promise.all([
    listMovementsPage({ itemId: item.id, page: requestedPage, perPage: MOVEMENTS_PER_PAGE }),
    canManage ? listCategories() : Promise.resolve([]),
    canManage ? listLocations() : Promise.resolve([]),
  ]);

  const pageCount = Math.max(1, Math.ceil(totalMovements / MOVEMENTS_PER_PAGE));
  const currentPage = Math.min(requestedPage, pageCount);
  const visibleMovements =
    currentPage === requestedPage
      ? movements
      : (await listMovementsPage({ itemId: item.id, page: currentPage, perPage: MOVEMENTS_PER_PAGE }))
          .rows;

  const retired = isRetiredCondition(item.condition);
  const assigned = isAssignedAsset(item);
  const inStorage = isStockStorageLocation(item.location_name);

  const statusTone =
    retired || assigned
      ? "default"
      : item.quantity <= 0
        ? "danger"
        : item.quantity <= item.min_quantity
          ? "warn"
          : "good";

  const statusCaption =
    item.condition !== "IN_SERVICE"
      ? item.condition_note?.trim() || CONDITION_META[item.condition]?.description
      : item.quantity <= 0
        ? "Out of stock — reorder as soon as possible."
        : item.quantity <= item.min_quantity
          ? `Only ${formatNumber(item.quantity)} left (min ${formatNumber(item.min_quantity)}) — consider reordering.`
          : assigned
            ? `Assigned to ${item.location_name}.`
            : inStorage
              ? `Healthy stock level in ${item.location_name}.`
              : "Unassigned — assign a storage location.";

  const details = [
    { label: "SKU / asset code", value: displaySku(item.sku), mono: !isPlaceholderSku(item.sku) },
    { label: "Category", value: item.category_name ?? "Uncategorised" },
    { label: "Location", value: item.location_name ?? "Unassigned" },
    { label: "Supplier", value: item.supplier ?? "-" },
    { label: "Unit of measure", value: item.unit },
    { label: "Minimum level", value: formatUnits(item.min_quantity, item.unit) },
    { label: "Added", value: formatDateTime(item.created_at) },
    { label: "Last updated", value: formatDateTime(item.updated_at) },
  ];

  return (
    <>
      <Link
        href="/inventory"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink/60 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to inventory
      </Link>

      <PageHeader
        eyebrow={item.category_name ?? "Uncategorised"}
        title={item.name}
        description={item.description ?? undefined}
        actions={
          canManage ? (
            <>
              <EditItemButton
                item={item}
                categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              />
              <DeleteItemButton
                id={item.id}
                name={item.name}
                movementCount={totalMovements}
                redirectTo="/inventory"
              />
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="On hand"
          value={formatUnits(item.quantity, item.unit)}
          hint={retired ? CONDITION_META[item.condition]?.label : `Minimum ${formatNumber(item.min_quantity)}`}
          tone={statusTone}
        />
        <StatCard label="Unit cost" value={formatCurrency(item.unit_cost)} />
        <StatCard
          label="Total value"
          value={formatCurrency(item.quantity * item.unit_cost)}
          hint="Quantity × unit cost"
        />
        <div className="panel flex flex-col justify-between p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/65">
            Status
          </div>
          <div className="mt-3">
            <StockPill
              quantity={item.quantity}
              min={item.min_quantity}
              assigned={assigned}
              condition={item.condition}
            />
          </div>
          <div className="mt-2 text-xs text-ink/60">{statusCaption}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <SectionCard title="Details" bodyClassName="divide-y divide-ink/5">
            {details.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="text-xs uppercase tracking-[0.1em] text-ink/60">
                  {row.label}
                </span>
                <span
                  className={`text-right text-sm text-ink/85 ${row.mono ? "font-mono" : ""}`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </SectionCard>

          {retired ? (
            <SectionCard title="Move this item" bodyClassName="">
              <EmptyState
                icon={<Lock size={20} />}
                title="Asset out of service"
                description={`This item is marked ${CONDITION_META[item.condition]?.label.toLowerCase()} and cannot receive, issue, or adjust stock.`}
              />
            </SectionCard>
          ) : canRecord ? (
            <SectionCard title="Move this item" bodyClassName="px-5 py-5">
              <MovementForm
                items={[]}
                lockedItem={{
                  id: item.id,
                  name: item.name,
                  sku: item.sku,
                  quantity: item.quantity,
                  unit: item.unit,
                  location_name: item.location_name,
                  condition: item.condition,
                }}
              />
            </SectionCard>
          ) : (
            <SectionCard title="Move this item" bodyClassName="">
              <EmptyState
                icon={<Lock size={20} />}
                title="Read-only access"
                description="Your role does not include recording stock movements."
              />
            </SectionCard>
          )}
        </div>

        <SectionCard
          title="Movement history"
          description={
            totalMovements > 0
              ? `${formatNumber(totalMovements)} recorded movement${totalMovements === 1 ? "" : "s"} · newest first`
              : "Newest first"
          }
          bodyClassName="overflow-x-auto"
        >
          {visibleMovements.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight size={20} />}
              title="No movements yet"
              description="Receipts and issues for this item will be listed here."
            />
          ) : (
            <>
              <table className="table-shell min-w-[560px]">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">Balance</th>
                    <th>By</th>
                    <th>Note</th>
                    <th className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <MovementTypeBadge type={m.type} withLabel />
                      </td>
                      <td
                        className={`text-right font-semibold tabular-nums ${
                          m.type === "OUT" || m.quantity < 0 ? "text-gold-700" : "text-iica-700"
                        }`}
                      >
                        {m.type === "OUT" || m.quantity < 0 ? "−" : "+"}
                        {formatNumber(Math.abs(m.quantity))}
                      </td>
                      <td className="text-right tabular-nums text-ink/75">
                        {formatNumber(m.balance_after)}
                      </td>
                      <td className="text-ink/70">{m.user_name ?? "Removed user"}</td>
                      <td
                        className="max-w-[200px] truncate text-ink/65"
                        title={m.note ?? undefined}
                      >
                        {m.note ?? "-"}
                      </td>
                      <td className="whitespace-nowrap text-right text-xs text-ink/65">
                        {formatDateTime(m.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={currentPage}
                perPage={MOVEMENTS_PER_PAGE}
                total={totalMovements}
                basePath={`/inventory/${item.id}`}
                params={{}}
              />
            </>
          )}
        </SectionCard>
      </div>
    </>
  );
}
