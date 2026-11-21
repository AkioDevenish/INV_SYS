"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { StockPill } from "@/components/ui";
import { IconButton, RowActions } from "@/components/icon-button";
import { Sku } from "@/components/sku";
import { isAssignedAsset } from "@/lib/conditions";
import { formatCurrency, formatNumber, formatUnits, relativeTime } from "@/lib/format";
import type { ItemRow } from "@/lib/queries";
import { DeleteItemFormBody } from "./[id]/delete-item";
import { UpdateItemForm, type ItemOption } from "./item-form";

export function InventoryList({
  items,
  categories,
  locations,
  canManage,
}: {
  items: ItemRow[];
  categories: ItemOption[];
  locations: ItemOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);

  return (
    <>
      {/* Phones and small tablets get a card per item - seven columns of
          sideways scrolling is not usable on a handset. */}
      <ul className="divide-y divide-ink/8 lg:hidden">
        {items.map((item) => {
          const assigned = isAssignedAsset(item);
          return (
            <li key={item.id} className="flex items-start gap-1 px-4 py-3.5">
              <Link href={`/inventory/${item.id}`} className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Sku sku={item.sku} className="text-xs text-ink/60" />
                    <div className="font-medium text-ink">{item.name}</div>
                  </div>
                  <StockPill
                    quantity={item.quantity}
                    min={item.min_quantity}
                    assigned={assigned}
                    condition={item.condition}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink/65">
                  <span className="font-semibold tabular-nums text-ink">
                    {formatUnits(item.quantity, item.unit)}
                  </span>
                  <span className="tabular-nums text-ink/75">
                    {formatCurrency(item.quantity * item.unit_cost)}
                  </span>
                  <span className="truncate">{item.category_name ?? "Uncategorised"}</span>
                  <span className="truncate">{item.location_name ?? "Unassigned"}</span>
                </div>
              </Link>
              {canManage && (
                <div className="flex shrink-0 flex-col">
                  <IconButton onClick={() => setEditing(item)} label={`Edit ${item.name}`}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleting(item)}
                    label={`Delete ${item.name}`}
                    tone="danger"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <table className="table-shell hidden min-w-[820px] lg:table">
        <thead>
          <tr>
            <th>SKU / asset code</th>
            <th>Item</th>
            <th>Category</th>
            <th>Location</th>
            <th className="text-right">On hand</th>
            <th className="text-right">Value</th>
            <th>Status</th>
            <th className="text-right">Updated</th>
            {canManage && <th className="w-24 text-right">Manage</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const assigned = isAssignedAsset(item);
            return (
              <tr key={item.id}>
                <td className="text-xs text-ink/65">
                  <Sku sku={item.sku} />
                </td>
                <td>
                  <Link href={`/inventory/${item.id}`} className="group block">
                    <span className="font-medium text-ink group-hover:text-iica-700">
                      {item.name}
                    </span>
                  </Link>
                </td>
                <td className="text-ink/70">{item.category_name ?? "-"}</td>
                <td className="text-ink/70">{item.location_name ?? "-"}</td>
                <td className="text-right tabular-nums">
                  <span className="font-semibold text-ink">{formatNumber(item.quantity)}</span>
                  <span className="ml-1 text-xs text-ink/60">
                    {formatUnits(item.quantity, item.unit).split(" ").slice(1).join(" ")}
                  </span>
                </td>
                <td className="text-right tabular-nums text-ink/75">
                  {formatCurrency(item.quantity * item.unit_cost)}
                </td>
                <td>
                  <StockPill
                    quantity={item.quantity}
                    min={item.min_quantity}
                    assigned={assigned}
                    condition={item.condition}
                  />
                </td>
                <td suppressHydrationWarning className="text-right text-xs text-ink/60">
                  {relativeTime(item.updated_at)}
                </td>
                {canManage && (
                  <td>
                    <RowActions>
                      <IconButton onClick={() => setEditing(item)} label={`Edit ${item.name}`}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton
                        onClick={() => setDeleting(item)}
                        label={`Delete ${item.name}`}
                        tone="danger"
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </RowActions>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : "Edit item"}
        description="Changing the quantity here is logged as a stock correction."
      >
        {editing && (
          <UpdateItemForm
            key={editing.id}
            item={editing}
            categories={categories}
            locations={locations}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this item?"
        width="max-w-md"
      >
        {deleting && (
          <DeleteItemFormBody
            key={deleting.id}
            id={deleting.id}
            name={deleting.name}
            onDone={() => setDeleting(null)}
          />
        )}
      </Modal>
    </>
  );
}
