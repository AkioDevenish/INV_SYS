"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Pencil, Plus, Save } from "lucide-react";
import { Modal } from "@/components/modal";
import {
  CONDITIONS,
  CONDITION_META,
  isRetiredCondition,
  type Condition,
} from "@/lib/conditions";
import { isPlaceholderSku } from "@/lib/sku";
import { IconButton } from "@/components/icon-button";
import { createItemAction, updateItemAction, type FormState } from "./actions";
import type { ItemRow, TaxonomyRow } from "@/lib/queries";

export type ItemOption = Pick<TaxonomyRow, "id" | "name">;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
      {pending ? "Saving…" : label}
    </button>
  );
}

function Fields({
  item,
  categories,
  locations,
}: {
  item?: ItemRow;
  categories: ItemOption[];
  locations: ItemOption[];
}) {
  // Controlled fields keep user input intact when a server validation error returns in React 19.
  const hasPlaceholderSku = Boolean(item?.sku && isPlaceholderSku(item.sku));
  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState(hasPlaceholderSku ? "" : (item?.sku ?? ""));
  const [unit, setUnit] = useState(item?.unit ?? "unit");
  const [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : "");
  const [locationId, setLocationId] = useState(item?.location_id ? String(item.location_id) : "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0));
  const [minQuantity, setMinQuantity] = useState(String(item?.min_quantity ?? 0));
  const [unitCost, setUnitCost] = useState(String(item?.unit_cost ?? 0));
  const [supplier, setSupplier] = useState(item?.supplier ?? "");
  const [condition, setCondition] = useState<Condition>(item?.condition ?? "IN_SERVICE");
  const [conditionNote, setConditionNote] = useState(item?.condition_note ?? "");
  const [description, setDescription] = useState(item?.description ?? "");

  const quantityLocked = Boolean(
    item && (isRetiredCondition(item.condition) || isRetiredCondition(condition)),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="name">
          Item name
        </label>
        <input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="sku">
          SKU / asset code <span className="font-normal text-ink/60">(optional)</span>
        </label>
        {hasPlaceholderSku && item?.sku && (
          <input type="hidden" name="existing_placeholder_sku" value={item.sku} />
        )}
        <input
          id="sku"
          name="sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="Asset code"
          className="field uppercase"
        />
        <p className="mt-1 text-xs text-ink/65">
          {hasPlaceholderSku
            ? "No asset code assigned yet — enter one to replace the internal placeholder."
            : "Leave blank if the code is not known."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="unit">
          Unit of measure
        </label>
        <input
          id="unit"
          name="unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="unit, box, litre…"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="category_id">
          Category
        </label>
        <select
          id="category_id"
          name="category_id"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="field"
        >
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="location_id">
          Location
        </label>
        <select
          id="location_id"
          name="location_id"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="field"
        >
          <option value="">Unassigned</option>
          {locations.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="quantity">
          Quantity on hand
        </label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min="0"
          step="1"
          readOnly={quantityLocked}
          value={quantityLocked && item ? String(item.quantity) : quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={`field ${quantityLocked ? "bg-ink/[0.04] text-ink/70" : ""}`}
        />
        {quantityLocked && (
          <p className="mt-1 text-xs text-ink/65">
            Quantity is locked while an item is decommissioned or disposed.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="min_quantity">
          Minimum level
        </label>
        <input
          id="min_quantity"
          name="min_quantity"
          type="number"
          min="0"
          step="1"
          value={minQuantity}
          onChange={(e) => setMinQuantity(e.target.value)}
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="unit_cost">
          Unit cost
        </label>
        <input
          id="unit_cost"
          name="unit_cost"
          type="number"
          min="0"
          step="0.01"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="supplier">
          Supplier
        </label>
        <input
          id="supplier"
          name="supplier"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Optional"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="condition">
          Condition
        </label>
        <select
          id="condition"
          name="condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value as Condition)}
          className="field"
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_META[c].label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="condition_note">
          Condition note
        </label>
        <input
          id="condition_note"
          name="condition_note"
          value={conditionNote}
          onChange={(e) => setConditionNote(e.target.value)}
          placeholder="Reason"
          className="field"
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor="description">
          Notes
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Serial number, condition or storage notes"
          className="field resize-y"
        />
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function CreateForm({
  categories,
  locations,
  onClose,
}: {
  categories: ItemOption[];
  locations: ItemOption[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(createItemAction, {});

  return (
    <form action={action}>
      <ErrorBanner message={state.error} />
      <Fields categories={categories} locations={locations} />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <Submit label="Create item" />
      </div>
    </form>
  );
}

export function NewItemButton({
  categories,
  locations,
}: {
  categories: ItemOption[];
  locations: ItemOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New item
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add an item"
        description="Anything the organisation holds - equipment, consumables or supplies."
      >
        <CreateForm
          categories={categories}
          locations={locations}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function UpdateItemForm({
  item,
  categories,
  locations,
  onDone,
}: {
  item: ItemRow;
  categories: ItemOption[];
  locations: ItemOption[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateItemAction, {});
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state.ok) {
      onDoneRef.current();
    }
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={item.id} />
      <ErrorBanner message={state.error} />
      <Fields key={item.id} item={item} categories={categories} locations={locations} />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <Submit label="Save changes" />
      </div>
    </form>
  );
}

export function EditItemButton({
  item,
  categories,
  locations,
  icon = false,
}: {
  item: ItemRow;
  categories: ItemOption[];
  locations: ItemOption[];
  /** Row actions are icon-only; the detail page uses the labelled button. */
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {icon ? (
        <IconButton onClick={() => setOpen(true)} label={`Edit ${item.name}`}>
          <Pencil size={15} />
        </IconButton>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          <Pencil size={15} /> Edit
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${item.name}`}
        description="Changing the quantity here is logged as a stock correction."
      >
        <UpdateItemForm
          item={item}
          categories={categories}
          locations={locations}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
