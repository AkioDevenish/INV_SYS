"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { IconButton } from "@/components/icon-button";
import { removeProjectRecordAction, type ProjectState } from "./actions";

type ServerAction = (prev: ProjectState, fd: FormData) => Promise<ProjectState>;

/**
 * A form wired to a server action that closes its modal on success. The
 * server action revalidates the page, so the new data simply appears.
 */
export function ActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel = "Saving…",
  onDone,
  children,
  danger = false,
}: {
  action: ServerAction;
  hidden?: Record<string, string | number | null | undefined>;
  submitLabel: string;
  pendingLabel?: string;
  onDone: (state: ProjectState) => void;
  children?: ReactNode;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ProjectState, FormData>(action, {});
  const [, startTransition] = useTransition();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (state.ok) doneRef.current(state);
  }, [state]);

  // Submitting through onSubmit rather than the action prop stops React from
  // resetting every field after the round trip, so a validation error leaves
  // what the person typed in place.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="space-y-3"
    >
      {hidden &&
        Object.entries(hidden).map(([k, v]) =>
          v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />,
        )}
      {children}
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-ghost w-full sm:w-auto" onClick={() => doneRef.current({})}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={`btn ${danger ? "btn-danger" : "btn-primary"} w-full sm:w-auto`}>
          {pending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** A trigger plus a modal holding an ActionForm. */
export function FormModalButton({
  trigger,
  title,
  description,
  width,
  render,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: string;
  width?: string;
  render: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} width={width}>
        {open && render(() => setOpen(false))}
      </Modal>
    </>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-ghost px-2.5 py-1.5 text-xs">
      <Plus size={13} /> {label}
    </button>
  );
}

export function EditIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <Pencil size={14} />
    </IconButton>
  );
}

/** Remove a child record of a project, with a confirmation step. */
export function RemoveRecordButton({
  kind,
  projectId,
  id,
  label,
  what,
}: {
  kind: "staff" | "stakeholder" | "funding" | "update" | "action" | "document" | "lesson";
  projectId: number;
  id: number;
  label: string;
  what: string;
}) {
  return (
    <FormModalButton
      title={label}
      description={what}
      width="max-w-md"
      trigger={(open) => (
        <IconButton label={label} onClick={open} tone="danger">
          <Trash2 size={14} />
        </IconButton>
      )}
      render={(close) => (
        <ActionForm
          action={removeProjectRecordAction}
          hidden={{ kind, project_id: projectId, id }}
          submitLabel="Remove"
          pendingLabel="Removing…"
          danger
          onDone={close}
        >
          <p className="text-sm text-ink/75">
            {kind === "document"
              ? "This unlinks the document from this project. The document record itself is kept while other projects still use it."
              : "This permanently removes the record. The audit trail keeps a note that it was removed."}
          </p>
        </ActionForm>
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-ink/60">{hint}</p>}
    </div>
  );
}

export type PickerOption = { id: number; name: string; organisation: string | null };

/**
 * Pick a stakeholder from the directory, or keep a typed name for an
 * organisation that has no contact on file. Submits `stakeholder_id` when a
 * directory entry is chosen and `stakeholder_name` otherwise.
 */
export function StakeholderPicker({
  options,
  initialId,
  initialName,
  label = "Stakeholder",
}: {
  options: PickerOption[];
  initialId?: number | null;
  initialName?: string | null;
  label?: string;
}) {
  const inputId = useId();
  const labelId = useId();
  const listId = useId();
  const initial = initialId ? options.find((o) => o.id === initialId) ?? null : null;
  const [selected, setSelected] = useState<PickerOption | null>(initial);
  const [query, setQuery] = useState(initial ? "" : initialName ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => `${o.name} ${o.organisation ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [options, query]);

  const choose = (o: PickerOption) => {
    setSelected(o);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div>
      {selected ? (
        <div id={labelId} className="label">
          {label}
        </div>
      ) : (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      {selected ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex items-center justify-between gap-2 rounded-xl border border-iica-300 bg-iica-50/60 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{selected.name}</div>
            {selected.organisation && <div className="truncate text-xs text-ink/60">{selected.organisation}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
              setActiveIndex(-1);
            }}
            aria-label="Choose someone else"
            className="rounded-lg p-1 text-ink/60 hover:bg-white hover:text-ink"
          >
            <X size={14} />
          </button>
          <input type="hidden" name="stakeholder_id" value={selected.id} />
        </div>
      ) : (
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        >
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/60" />
          <input
            id={inputId}
            name="stakeholder_name"
            value={query}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              open && activeIndex >= 0 && matches[activeIndex]
                ? `${listId}-opt-${matches[activeIndex].id}`
                : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open || matches.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % matches.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
              } else if (e.key === "Enter" && activeIndex >= 0 && matches[activeIndex]) {
                e.preventDefault();
                choose(matches[activeIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                setActiveIndex(-1);
              }
            }}
            placeholder="Search the directory or type an organisation"
            className="field pl-8"
          />
          {open && matches.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label={label}
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-ink/10 bg-white py-1 shadow-lg"
            >
              {matches.map((o, i) => (
                <li
                  key={o.id}
                  id={`${listId}-opt-${o.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`block w-full px-3 py-2 text-left text-sm ${i === activeIndex ? "bg-iica-50" : "hover:bg-iica-50"}`}
                  >
                    <span className="font-medium text-ink">{o.name}</span>
                    {o.organisation && <span className="ml-1.5 text-xs text-ink/60">{o.organisation}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-ink/60">
            {query.trim() && matches.length === 0
              ? "Not in the directory. The typed name will be saved as is."
              : "Pick from the stakeholder directory, or type a name that isn't in it."}
          </p>
        </div>
      )}
    </div>
  );
}

export function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {children}
    </span>
  );
}
