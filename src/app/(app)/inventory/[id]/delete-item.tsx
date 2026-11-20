"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/modal";
import { IconButton } from "@/components/icon-button";
import { formatNumber } from "@/lib/format";
import { deleteItemAction, type FormState } from "../actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      {pending ? "Deleting…" : "Delete permanently"}
    </button>
  );
}

export function DeleteItemFormBody({
  id,
  name,
  movementCount,
  redirectTo,
  onDone,
}: {
  id: number;
  name: string;
  movementCount?: number;
  redirectTo?: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(deleteItemAction, {});
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
    <>
      <div className="space-y-3">
        <div className="flex gap-3 rounded-xl border border-rose-500/25 bg-rose-500/8 p-4 text-sm text-rose-800">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose-600" />
          <div className="space-y-1.5">
            <p>
              <strong className="font-semibold">{name}</strong>{" "}
              {movementCount !== undefined && movementCount > 0
                ? `has ${formatNumber(movementCount)} recorded stock movement${movementCount === 1 ? "" : "s"}. Deleting it will permanently erase that movement history and alter historical volume charts.`
                : "and any recorded stock movement history will be permanently removed."}
            </p>
            <p className="text-xs text-rose-800/90">
              The deletion itself stays in the audit trail, but the stock history cannot be
              recovered.
            </p>
          </div>
        </div>
        {(movementCount === undefined || movementCount > 0) && (
          <p className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3.5 py-2.5 text-xs leading-relaxed text-gold-700">
            <strong>Tip:</strong> To retire an asset without losing its movement history, edit the
            item and set its condition to <strong>Decommissioned</strong> or{" "}
            <strong>Disposed</strong> instead of deleting it.
          </p>
        )}
      </div>
      {state.error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <form action={action} className="mt-5 flex justify-end gap-2">
        <input type="hidden" name="id" value={id} />
        {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Keep item
        </button>
        <ConfirmButton />
      </form>
    </>
  );
}

export function DeleteItemButton({
  id,
  name,
  movementCount,
  icon = false,
  redirectTo,
}: {
  id: number;
  name: string;
  movementCount?: number;
  /** Row actions are icon-only; the detail page uses the labelled button. */
  icon?: boolean;
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {icon ? (
        <IconButton onClick={() => setOpen(true)} label={`Delete ${name}`} tone="danger">
          <Trash2 size={15} />
        </IconButton>
      ) : (
        <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
          <Trash2 size={15} /> Delete
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this item?"
        width="max-w-md"
      >
        <DeleteItemFormBody
          id={id}
          name={name}
          movementCount={movementCount}
          redirectTo={redirectTo}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
