"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { IconButton } from "@/components/icon-button";
import { STATUS_META, TASK_STATUSES, type TaskStatus } from "@/lib/timelines";
import { deleteTaskAction, setTaskStatusAction, type TaskState } from "./actions";

/**
 * Status changes far more often than anything else on a task, so it is a
 * one-click control in the row rather than a trip through the editor.
 */
export function StatusPicker({
  id,
  title,
  status,
  progress,
}: {
  id: number;
  title: string;
  status: string;
  progress: number | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const meta = STATUS_META[status as TaskStatus];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          value={status}
          disabled={pending}
          aria-label={`Status for ${title}`}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("id", String(id));
            fd.set("status", e.target.value);
            setError(undefined);
            start(async () => {
              const res = await setTaskStatusAction(fd);
              if (res.error) setError(res.error);
            });
          }}
          className={`chip cursor-pointer appearance-none pr-2 ${meta?.chip ?? ""} ${
            pending ? "opacity-50" : ""
          }`}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        {progress !== null && (
          <span className="text-xs tabular-nums text-ink/55">{progress}%</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function DeleteTaskForm({ id, onClose }: { id: number; onClose: () => void }) {
  const [state, action, pending] = useActionState<TaskState, FormData>(deleteTaskAction, {});

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <>
      <p className="text-sm leading-relaxed text-ink/60">
        This removes the task permanently along with any linked timeline calendar entries. The
        deletion stays in the audit trail.
      </p>
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
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          {pending ? "Deleting…" : "Delete"}
        </button>
      </form>
    </>
  );
}

export function DeleteTaskButton({ id, title }: { id: number; title: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        label={`Delete ${title}`}
        tone="danger"
        onClick={() => setOpen(true)}
      >
        <Trash2 size={15} />
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${title}?`}
        width="max-w-md"
      >
        {open && <DeleteTaskForm id={id} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}
