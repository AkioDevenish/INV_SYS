"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { CONDITION_META, type Condition } from "@/lib/conditions";
import { formatUnits } from "@/lib/format";
import { displaySku } from "@/lib/sku";
import { recordMovementAction, type MovementState } from "./actions";

export type MovementItemOption = {
  id: number;
  name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  location_name?: string | null;
  condition?: Condition;
};

const TYPES = [
  { value: "IN", label: "Receive", icon: ArrowDownLeft, hint: "Adds to the quantity on hand" },
  { value: "OUT", label: "Issue", icon: ArrowUpRight, hint: "Takes stock out of the store" },
  {
    value: "ADJUST",
    label: "Correct",
    icon: SlidersHorizontal,
    hint: "Sets the quantity to a counted figure",
  },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Recording…" : "Record movement"}
    </button>
  );
}

export function MovementForm({
  items,
  lockedItem,
}: {
  items: MovementItemOption[];
  lockedItem?: MovementItemOption;
}) {
  const [state, action] = useActionState<MovementState, FormData>(recordMovementAction, {});
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("IN");
  const [itemId, setItemId] = useState<string>(lockedItem ? String(lockedItem.id) : "");
  const [itemQuery, setItemQuery] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [dismissedState, setDismissedState] = useState<MovementState | null>(null);

  useEffect(() => {
    setDismissedState(null);
    if (state.ok) {
      setQuantity("");
      setNote("");
    }
  }, [state]);

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = `${item.name} ${item.sku ?? ""} ${item.location_name ?? ""}`.toLowerCase();
      return hay.includes(q) || String(item.id) === itemId;
    });
  }, [items, itemQuery, itemId]);

  const selected = lockedItem ?? items.find((i) => String(i.id) === itemId);
  const activeType = TYPES.find((t) => t.value === type)!;
  const showFeedback = dismissedState !== state;

  const dismissBanner = () => setDismissedState(state);

  return (
    <form action={action} className="space-y-4">
      {showFeedback && state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {showFeedback && state.ok && state.message && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-iica-600/30 bg-iica-600/10 px-3 py-2.5 text-sm text-iica-800"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div>
        <span className="label">Movement type</span>
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map((option) => {
            const Icon = option.icon;
            const active = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setType(option.value);
                  dismissBanner();
                }}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition ${
                  active
                    ? "border-iica-600 bg-iica-100 text-iica-800"
                    : "border-ink/10 bg-ink/[0.02] text-ink/60 hover:bg-ink/[0.05]"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink/60">{activeType.hint}</p>
      </div>
      <input type="hidden" name="type" value={type} />

      {lockedItem ? (
        <input type="hidden" name="item_id" value={lockedItem.id} />
      ) : (
        <div className="space-y-2">
          <div>
            <label className="label" htmlFor="item_search">
              Find item
            </label>
            <div className="relative">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/55"
              />
              <input
                id="item_search"
                type="search"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder="Filter by name, SKU, or location…"
                className="field pl-8 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="item_id">
              Item{" "}
              {itemQuery.trim() && (
                <span className="font-normal text-ink/60">
                  ({filteredItems.length} of {items.length})
                </span>
              )}
            </label>
            <select
              id="item_id"
              name="item_id"
              required
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                dismissBanner();
              }}
              className="field"
            >
              <option value="">Select an item…</option>
              {filteredItems.map((item) => {
                const condLabel =
                  item.condition && item.condition !== "IN_SERVICE"
                    ? ` · ${CONDITION_META[item.condition]?.label ?? item.condition}`
                    : "";
                const locLabel = item.location_name ? ` · ${item.location_name}` : "";
                return (
                  <option key={item.id} value={item.id}>
                    {item.name} · {displaySku(item.sku)}
                    {locLabel} ({formatUnits(item.quantity, item.unit)})
                    {condLabel}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="quantity">
          {type === "ADJUST" ? "Counted quantity" : "Quantity"}
        </label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min={type === "ADJUST" ? 0 : 1}
          step="1"
          required
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            dismissBanner();
          }}
          placeholder="0"
          className="field"
        />
        {selected && (
          <p className="mt-2 text-xs text-ink/60">
            Currently {formatUnits(selected.quantity, selected.unit)} on hand
            {selected.location_name ? ` at ${selected.location_name}` : ""}.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="note">
          Reference / note
        </label>
        <input
          id="note"
          name="note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            dismissBanner();
          }}
          placeholder="Delivery note, requesting department…"
          className="field"
        />
      </div>

      <Submit />
    </form>
  );
}
