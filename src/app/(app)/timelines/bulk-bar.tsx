"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { Modal } from "@/components/modal";
import { STATUS_META, TASK_STATUSES } from "@/lib/timelines";
import { bulkUpdateTasksAction, type BulkTaskOp } from "./actions";
import type { OwnerOption } from "./task-forms";

/** Appears once tasks are ticked: change status, owner or dates for all of them at once. */
export function BulkBar({
  ids,
  owners,
  onDone,
}: {
  ids: number[];
  owners: OwnerOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (op: BulkTaskOp) =>
    start(async () => {
      const res = await bulkUpdateTasksAction(ids, op);
      if (res.error) setNote({ tone: "error", text: res.error });
      else {
        setNote(null);
        setConfirmDelete(false);
        onDone();
      }
    });

  return (
    <div className="animate-fade sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-iica-200 bg-iica-50/95 px-4 py-2.5 backdrop-blur sm:px-5">
      <span className="text-xs font-semibold text-iica-900">
        {ids.length} selected
      </span>
      <FilterSelect
        value=""
        ariaLabel="Set status"
        className="min-w-[9rem]"
        options={[
          { value: "", label: "Set status…" },
          ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
        ]}
        onChange={(v) => v && run({ kind: "status", status: v })}
      />
      {owners.length > 0 && (
        <FilterSelect
          value=""
          ariaLabel="Set accountable person"
          className="min-w-[10rem]"
          options={[
            { value: "", label: "Assign to…" },
            { value: "none", label: "Nobody" },
            ...owners.map((o) => ({ value: String(o.id), label: o.name })),
          ]}
          onChange={(v) => v && run({ kind: "owner", ownerId: v === "none" ? null : Number(v) })}
        />
      )}
      <FilterSelect
        value=""
        ariaLabel="Move dates"
        className="min-w-[9rem]"
        options={[
          { value: "", label: "Move dates…" },
          { value: "7", label: "1 week later" },
          { value: "14", label: "2 weeks later" },
          { value: "30", label: "30 days later" },
          { value: "-7", label: "1 week earlier" },
        ]}
        onChange={(v) => v && run({ kind: "shift", days: Number(v) })}
      />
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
      >
        <Trash2 size={13} aria-hidden="true" /> Delete
      </button>
      {pending && <Loader2 size={15} className="animate-spin text-iica-700" aria-label="Saving" />}
      {note && <span className={`text-xs ${note.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>{note.text}</span>}
      <button
        type="button"
        onClick={onDone}
        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink/60 hover:bg-white hover:text-ink"
      >
        <X size={13} aria-hidden="true" /> Clear
      </button>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`}
        width="max-w-md"
      >
        <p className="text-sm text-ink/75">
          This permanently removes the selected tasks and their progress notes. The audit trail keeps a record that
          they were deleted.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run({ kind: "delete" })}>
            {pending && <Loader2 size={14} className="animate-spin" />}
            Delete tasks
          </button>
        </div>
      </Modal>
    </div>
  );
}
