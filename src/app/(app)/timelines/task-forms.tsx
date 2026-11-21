"use client";

import { FilterSelect } from "@/components/filter-select";

import { useActionState, useEffect, useId, useState } from "react";
import { Pencil, Plus, Upload } from "lucide-react";
import { Modal } from "@/components/modal";
import { IconButton } from "@/components/icon-button";
import {
  PRIORITIES,
  PRIORITY_META,
  STATUS_META,
  TASK_STATUSES,
  type Priority,
  type TaskStatus,
} from "@/lib/timelines";
import { importTimelinesAction, saveTaskAction, type TaskState } from "./actions";

export type TaskRow = {
  id: number;
  area: string;
  owner_id?: number | null;
  title: string;
  lead: string | null;
  origin: string | null;
  priority: string;
  status: string;
  progress: number | null;
  starts_on: string | null;
  ends_on: string | null;
  schedule_note: string | null;
  comments: string | null;
  recurrence?: string | null;
};

export type OwnerOption = { id: number; name: string; disabled?: boolean };

function TaskForm({
  task,
  initialArea,
  areas,
  owners,
  onClose,
}: {
  task?: TaskRow;
  initialArea?: string;
  areas: string[];
  owners: OwnerOption[];
  onClose: () => void;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<TaskState, FormData>(saveTaskAction, {});

  const [title, setTitle] = useState(task?.title ?? "");
  const [area, setArea] = useState(task?.area ?? initialArea ?? "");
  const [lead, setLead] = useState(task?.lead ?? "");
  const [ownerId, setOwnerId] = useState(task?.owner_id ? String(task.owner_id) : "");
  const [origin, setOrigin] = useState(task?.origin ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "M");
  const [startsOn, setStartsOn] = useState(task?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(task?.ends_on ?? "");
  const [status, setStatus] = useState(task?.status ?? "NOT_STARTED");
  const [progress, setProgress] = useState(
    task?.progress !== null && task?.progress !== undefined ? String(task.progress) : "",
  );
  const [scheduleNote, setScheduleNote] = useState(task?.schedule_note ?? "");
  const [comments, setComments] = useState(task?.comments ?? "");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const handleStatusChange = (nextStatus: string) => {
    setStatus(nextStatus);
    if (nextStatus === "COMPLETE") {
      setProgress("100");
    } else if (nextStatus === "NOT_STARTED" && progress !== "") {
      setProgress("0");
    }
  };

  const handleProgressChange = (nextRaw: string) => {
    setProgress(nextRaw);
    if (nextRaw.trim() === "") return;
    const n = Number(nextRaw);
    if (!Number.isFinite(n)) return;
    if (n >= 100) setStatus("COMPLETE");
    else if (n <= 0 && status !== "DELAYED") setStatus("NOT_STARTED");
    else if (n > 0 && (status === "NOT_STARTED" || status === "COMPLETE")) setStatus("ONGOING");
  };

  return (
    <form action={action} className="space-y-3">
      {task && <input type="hidden" name="id" value={task.id} />}
      <div>
        <label className="label" htmlFor={`${uid}-title`}>
          Task
        </label>
        <input
          id={`${uid}-title`}
          name="title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Report prep, training, mission…"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-area`}>
            Area
          </label>
          <input
            id={`${uid}-area`}
            name="area"
            className="field"
            list={`${uid}-areas`}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="TC, Admin, initials…"
          />
          <datalist id={`${uid}-areas`}>
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-lead`}>
            Lead or team
          </label>
          <input
            id={`${uid}-lead`}
            name="lead"
            className="field"
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            placeholder="LH/GEH"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${uid}-owner`}>
          Accountable person
        </label>
        <FilterSelect
          id={`${uid}-owner`}
          name="owner_id"
          size="md"
          ariaLabel="Accountable person"
          value={ownerId}
          onChange={setOwnerId}
          options={[
            { value: "", label: "Nobody assigned" },
            ...owners.map((o) => ({ value: String(o.id), label: o.disabled ? `${o.name} (Disabled)` : o.name })),
          ]}
        />
        <p className="mt-1.5 text-xs text-ink/50">
          Whoever is named here can update this task&apos;s progress themselves.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-origin`}>
            Origin
          </label>
          <input
            id={`${uid}-origin`}
            name="origin"
            className="field"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="TT ANSP"
          />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-priority`}>
            Priority
          </label>
          <select
            id={`${uid}-priority`}
            name="priority"
            className="field"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p as Priority].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-starts`}>
            Starts
          </label>
          <input
            id={`${uid}-starts`}
            type="date"
            name="starts_on"
            className="field"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-ends`}>
            Due
          </label>
          <input
            id={`${uid}-ends`}
            type="date"
            name="ends_on"
            className="field"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-status`}>
            Status
          </label>
          <select
            id={`${uid}-status`}
            name="status"
            className="field"
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s as TaskStatus].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-progress`}>
            Progress %
          </label>
          <input
            id={`${uid}-progress`}
            type="number"
            name="progress"
            min={0}
            max={100}
            className="field"
            value={progress}
            onChange={(e) => handleProgressChange(e.target.value)}
            placeholder="Leave blank if not tracked"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${uid}-schedule`}>
          Schedule note
        </label>
        <input
          id={`${uid}-schedule`}
          name="schedule_note"
          className="field"
          value={scheduleNote}
          onChange={(e) => setScheduleNote(e.target.value)}
          placeholder="9am-1pm, All day, Sep 26 · Oct 26…"
        />
      </div>

      <div>
        <label className="label" htmlFor={`${uid}-recurrence`}>
          Repeats
        </label>
        <select
          id={`${uid}-recurrence`}
          name="recurrence"
          className="field"
          defaultValue={task?.recurrence ?? ""}
        >
          <option value="">Doesn&apos;t repeat</option>
          <option value="WEEKLY">Every week</option>
          <option value="MONTHLY">Every month</option>
          <option value="QUARTERLY">Every quarter</option>
        </select>
        <p className="mt-1.5 text-xs text-ink/55">
          Marking a repeating task complete creates the next one with its dates moved on.
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`${uid}-comments`}>
          Comments
        </label>
        <textarea
          id={`${uid}-comments`}
          name="comments"
          className="field min-h-20"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : task ? "Save changes" : "Add task"}
        </button>
      </div>
    </form>
  );
}

export function NewTaskButton({
  areas,
  owners,
  area,
}: {
  areas: string[];
  owners: OwnerOption[];
  area?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New task
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a task"
        description="Something this office is working to, with whoever is leading it."
      >
        {open && (
          <TaskForm
            initialArea={area}
            areas={areas}
            owners={owners}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

export function EditTaskButton({
  task,
  areas,
  owners,
}: {
  task: TaskRow;
  areas: string[];
  owners: OwnerOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={`Edit ${task.title}`} onClick={() => setOpen(true)}>
        <Pencil size={15} />
      </IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit task" description={task.title}>
        {open && (
          <TaskForm
            task={task}
            areas={areas}
            owners={owners}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

function ImportTimelinesForm({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const [state, action, pending] = useActionState<TaskState, FormData>(importTimelinesAction, {});
  const defaultYear = new Date().getFullYear();

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor={`${uid}-file`}>
          Workbook
        </label>
        <input
          id={`${uid}-file`}
          type="file"
          name="timeline_file"
          accept=".xlsx"
          className="field text-xs"
          required
        />
        <p className="mt-1.5 text-xs text-ink/50">
          Handles all three layouts: dated activities, tasks repeating on a day of each month,
          and a personal list with a due date and progress.
        </p>
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-year`}>
          Reporting year
        </label>
        <input
          id={`${uid}-year`}
          type="number"
          name="year"
          className="field"
          min={2000}
          max={2100}
          defaultValue={defaultYear}
        />
        <p className="mt-1.5 text-xs text-ink/50">
          The sheets give a month and a day but no year, so dates are built against this.
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p aria-live="polite" className="text-sm text-iica-700">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={pending}>
          {state.ok ? "Done" : "Cancel"}
        </button>
        <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
          {pending ? "Reading the workbook…" : "Import tasks"}
        </button>
      </div>
    </form>
  );
}

export function ImportTimelinesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Upload size={15} /> Import
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Import a timelines workbook"
        description="Reads every sheet. A task already tracked under the same area is left alone."
      >
        {open && <ImportTimelinesForm onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}
