"use client";

import { useActionState, useEffect, useState } from "react";
import { GaugeCircle } from "lucide-react";
import { Modal } from "@/components/modal";
import { STATUS_META, TASK_STATUSES, type TaskStatus } from "@/lib/timelines";
import { updateProgressAction, type TaskState } from "./actions";

/** Colour follows how far along the task is, not its status chip. */
function barTone(progress: number): string {
  if (progress >= 100) return "bg-emerald-500";
  if (progress >= 60) return "bg-iica-600";
  if (progress >= 25) return "bg-gold-500";
  return "bg-rose-400";
}

function barWidth(progress: number): string {
  if (progress <= 0) return "0%";
  return `${Math.min(100, Math.max(2, progress))}%`;
}

export function ProgressBar({
  progress,
  note,
  updatedAt,
  updatedBy,
}: {
  progress: number | null;
  note?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}) {
  if (progress === null) {
    return <span className="text-xs text-ink/45">Not reported</span>;
  }
  const title = [
    note,
    updatedBy && updatedAt ? `Updated by ${updatedBy} on ${updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="min-w-[7.5rem]" title={title || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums text-ink/75">{progress}%</span>
        {note && <span className="truncate text-[11px] text-ink/50">{note}</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barTone(progress)}`}
          style={{ width: barWidth(progress) }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

function UpdateProgressForm({
  id,
  progress,
  note,
  status,
  onClose,
}: {
  id: number;
  progress: number | null;
  note: string | null;
  status: string;
  onClose: () => void;
}) {
  const initialValue = progress ?? (status === "COMPLETE" ? 100 : 0);
  const [value, setValue] = useState(initialValue);
  const [draft, setDraft] = useState(String(initialValue));
  const [noteText, setNoteText] = useState(note ?? "");
  const [statusValue, setStatusValue] = useState(status);
  const [state, action, pending] = useActionState<TaskState, FormData>(updateProgressAction, {});

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const applyProgress = (nextVal: number, syncDraft: boolean) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
    setValue(clamped);
    if (syncDraft) setDraft(String(clamped));

    if (clamped >= 100) {
      setStatusValue("COMPLETE");
    } else if (clamped === 0) {
      if (statusValue !== "DELAYED") setStatusValue("NOT_STARTED");
    } else if (statusValue === "NOT_STARTED" || statusValue === "COMPLETE") {
      setStatusValue("ONGOING");
    }
  };

  const applyStatus = (nextStatus: string) => {
    setStatusValue(nextStatus);
    if (nextStatus === "COMPLETE") {
      setValue(100);
      setDraft("100");
    } else if (nextStatus === "NOT_STARTED") {
      setValue(0);
      setDraft("0");
    } else if ((nextStatus === "ONGOING" || nextStatus === "DELAYED") && value >= 100) {
      setValue(95);
      setDraft("95");
    }
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />

      <div>
        <label className="label" htmlFor={`p-${id}`}>
          How far along
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`p-${id}`}
            type="range"
            min={0}
            max={100}
            step={5}
            value={value}
            onChange={(e) => applyProgress(Number(e.target.value), true)}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink/10 accent-iica-700"
          />
          <input
            type="number"
            name="progress"
            min={0}
            max={100}
            value={draft}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              if (raw.trim() === "") return;
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) applyProgress(parsed, false);
            }}
            onBlur={() => setDraft(String(value))}
            className="field w-20 text-center tabular-nums"
            aria-label="Progress percentage"
          />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barTone(value)}`}
            style={{ width: barWidth(value) }}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`n-${id}`}>
          What is left to do
        </label>
        <textarea
          id={`n-${id}`}
          name="progress_note"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          className="field min-h-24"
          placeholder="Add a progress note"
        />
        <p className="mt-1.5 text-xs text-ink/50">
          Visible to all staff with access to timelines.
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`s-${id}`}>
          Status
        </label>
        <select
          id={`s-${id}`}
          name="status"
          className="field"
          value={statusValue}
          onChange={(e) => applyStatus(e.target.value)}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s as TaskStatus].label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink/50">
          Complete sets 100%; Not started resets to 0%.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save update"}
      </button>
    </form>
  );
}

export function UpdateProgressButton({
  id,
  title,
  progress,
  note,
  status,
  owned,
}: {
  id: number;
  title: string;
  progress: number | null;
  note: string | null;
  status: string;
  /** True when the signed-in person is the one accountable for this task. */
  owned: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={owned ? `Update your progress for ${title}` : `Update progress for ${title}`}
        aria-label={`Update progress for ${title}`}
        className="rounded-lg p-2 text-ink/55 transition hover:bg-iica-50 hover:text-iica-700"
      >
        <GaugeCircle size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Update progress" description={title}>
        {open && (
          <UpdateProgressForm
            id={id}
            progress={progress}
            note={note}
            status={status}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}
