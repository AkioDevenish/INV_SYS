"use client";

import { FilterSelect } from "@/components/filter-select";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import type {
  ActionRow,
  DocumentRow,
  FundingRow,
  ProjectLesson,
  ResourceOption,
  StaffRow,
  StakeholderLinkRow,
  UpdateRow,
} from "@/lib/projects";
import {
  ACTION_STATES,
  ACTION_STATE_META,
  APPROVAL_META,
  APPROVAL_STATES,
  CURRENCIES,
  INVOLVEMENT_ROLES,
  RESOURCE_TYPES,
  astTodayKey,
} from "@/lib/project-meta";
import {
  saveActionItemAction,
  saveDocumentAction,
  saveFundingAction,
  saveLessonAction,
  saveStaffAction,
  saveStakeholderLinkAction,
  saveUpdateAction,
  setActionStateAction,
  setProjectPhaseAction,
} from "../actions";
import { ActionForm, Field, StakeholderPicker, type PickerOption } from "../project-ui";

export type Person = { id: number; name: string };
export type Ref = { id: number; name: string; position?: number };

type Done = () => void;

/* ---------- staff ---------- */

export function StaffForm({
  projectId,
  row,
  people,
  roles,
  onDone,
}: {
  projectId: number;
  row?: StaffRow;
  people: Person[];
  roles: Ref[];
  onDone: Done;
}) {
  const options = row && !people.some((p) => p.id === row.user_id) ? [{ id: row.user_id, name: `${row.name} (inactive)` }, ...people] : people;
  return (
    <ActionForm action={saveStaffAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Assign"} onDone={onDone}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Staff member">
          {(id) => (
            <FilterSelect
              id={id}
              name="user_id"
              size="md"
              ariaLabel="Staff member"
              defaultValue={row ? String(row.user_id) : ""}
              options={[{ value: "", label: "Choose a person", disabled: true }, ...options.map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          )}
        </Field>
        <Field label="Project role" hint="One person may hold several roles.">
          {(id) => (
            <select id={id} name="role_id" className="field" required defaultValue={row?.role_id ?? ""}>
              <option value="" disabled>
                Choose a role
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="From">
          {(id) => <input id={id} type="date" name="start_date" className="field" defaultValue={row?.start_date ?? ""} />}
        </Field>
        <Field label="Until" hint="Leave blank while the assignment is current.">
          {(id) => <input id={id} type="date" name="end_date" className="field" defaultValue={row?.end_date ?? ""} />}
        </Field>
      </div>
    </ActionForm>
  );
}

/* ---------- stakeholders ---------- */

export function StakeholderLinkForm({
  projectId,
  row,
  directory,
  onDone,
}: {
  projectId: number;
  row?: StakeholderLinkRow;
  directory: PickerOption[];
  onDone: Done;
}) {
  return (
    <ActionForm action={saveStakeholderLinkAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Add stakeholder"} onDone={onDone}>
      <StakeholderPicker options={directory} initialId={row?.stakeholder_id} initialName={row?.stakeholder_id ? null : row?.name} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Involvement" className="sm:col-span-1">
          {(id) => (
            <>
              <input id={id} name="involvement_role" list={`${id}-roles`} className="field" defaultValue={row?.involvement_role ?? ""} placeholder="Implementing partner…" />
              <datalist id={`${id}-roles`}>
                {INVOLVEMENT_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="From">
          {(id) => <input id={id} type="date" name="start_date" className="field" defaultValue={row?.start_date ?? ""} />}
        </Field>
        <Field label="Until">
          {(id) => <input id={id} type="date" name="end_date" className="field" defaultValue={row?.end_date ?? ""} />}
        </Field>
      </div>
      <Field label="Notes">
        {(id) => <textarea id={id} name="notes" rows={2} className="field" defaultValue={row?.notes ?? ""} />}
      </Field>
    </ActionForm>
  );
}

/* ---------- funding ---------- */

export function FundingForm({
  projectId,
  row,
  directory,
  statuses,
  onDone,
}: {
  projectId: number;
  row?: FundingRow;
  directory: PickerOption[];
  statuses: Ref[];
  onDone: Done;
}) {
  const initialCurrency = row?.currency_code ?? "TTD";
  return (
    <ActionForm action={saveFundingAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Add funding"} onDone={onDone}>
      <StakeholderPicker label="Funder" options={directory} initialId={row?.funder_id} initialName={row?.funder_id ? null : row?.funder} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Funding status">
          {(id) => (
            <select id={id} name="funding_status_id" className="field" defaultValue={row?.funding_status_id ?? ""}>
              <option value="">Not set</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Status since">
          {(id) => <input id={id} type="date" name="status_date" className="field" defaultValue={row?.status_date ?? ""} />}
        </Field>
        <Field label="Currency" hint="Totals are kept per currency.">
          {(id) => (
            <>
              <input id={id} name="currency_code" list={`${id}-cur`} className="field uppercase" maxLength={3} defaultValue={initialCurrency} />
              <datalist id={`${id}-cur`}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Requested">
          {(id) => <input id={id} name="amount_requested" inputMode="decimal" className="field tabular-nums" defaultValue={row?.amount_requested ?? ""} />}
        </Field>
        <Field label="Approved">
          {(id) => <input id={id} name="amount_approved" inputMode="decimal" className="field tabular-nums" defaultValue={row?.amount_approved ?? ""} />}
        </Field>
        <Field label="Received to date" hint="Running total">
          {(id) => <input id={id} name="amount_received" inputMode="decimal" className="field tabular-nums" defaultValue={row?.amount_received ?? ""} />}
        </Field>
      </div>
      <Field label="Notes">
        {(id) => <textarea id={id} name="notes" rows={2} className="field" defaultValue={row?.notes ?? ""} />}
      </Field>
    </ActionForm>
  );
}

/* ---------- updates ---------- */

export function UpdateForm({
  projectId,
  row,
  todayKey,
  onDone,
}: {
  projectId: number;
  row?: UpdateRow;
  todayKey?: string;
  onDone: Done;
}) {
  return (
    <ActionForm action={saveUpdateAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Post update"} onDone={onDone}>
      <Field label="Date it happened">
        {(id) => <input id={id} type="date" name="update_date" className="field sm:w-48" defaultValue={row?.update_date ?? todayKey ?? astTodayKey()} required />}
      </Field>
      <Field label="What happened, changed or was decided">
        {(id) => <textarea id={id} name="body" rows={5} className="field" defaultValue={row?.body ?? ""} required />}
      </Field>
    </ActionForm>
  );
}

/* ---------- follow-up actions ---------- */

export function ActionItemForm({
  projectId,
  row,
  people,
  onDone,
}: {
  projectId: number;
  row?: ActionRow;
  people: Person[];
  onDone: Done;
}) {
  const [state, setState] = useState<string>(row?.state ?? "OPEN");
  const options =
    row?.assigned_user_id && !people.some((p) => p.id === row.assigned_user_id)
      ? [{ id: row.assigned_user_id, name: `${row.assigned_name ?? "Former user"} (inactive)` }, ...people]
      : people;
  return (
    <ActionForm action={saveActionItemAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Add action"} onDone={onDone}>
      <Field label="Action">
        {(id) => <textarea id={id} name="description" rows={3} className="field" defaultValue={row?.description ?? ""} required />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Responsible">
          {(id) => (
            <FilterSelect
              id={id}
              name="assigned_user_id"
              size="md"
              ariaLabel="Responsible"
              defaultValue={row?.assigned_user_id ? String(row.assigned_user_id) : ""}
              options={[{ value: "", label: "Unassigned" }, ...options.map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          )}
        </Field>
        <Field label="Due">
          {(id) => <input id={id} type="date" name="due_date" className="field" defaultValue={row?.due_date ?? ""} />}
        </Field>
        <Field label="State">
          {(id) => (
            <select
              id={id}
              name="state"
              className="field"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              {ACTION_STATES.map((s) => (
                <option key={s} value={s}>
                  {ACTION_STATE_META[s].label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {state === "DONE" && (
        <Field label="Completed on" hint="Preserved on edit; defaults to today if left blank.">
          {(id) => (
            <input
              id={id}
              type="date"
              name="completed_on"
              className="field sm:w-48"
              defaultValue={row?.completed_on ?? ""}
            />
          )}
        </Field>
      )}
    </ActionForm>
  );
}

export function ActionStateSelect({ row }: { row: ActionRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select
          value={row.state}
          disabled={pending}
          aria-label={`State of ${row.description}`}
          onChange={(e) => {
            const next = e.target.value;
            setError(undefined);
            start(async () => {
              const res = await setActionStateAction(row.id, next);
              if (res.error) setError(res.error);
            });
          }}
          className="field w-auto py-1 pr-7 pl-2 text-xs"
        >
          {ACTION_STATES.map((s) => (
            <option key={s} value={s}>
              {ACTION_STATE_META[s].label}
            </option>
          ))}
        </select>
        {pending && <Loader2 size={13} aria-hidden="true" className="animate-spin text-ink/60" />}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- documents ---------- */

export function DocumentForm({
  projectId,
  row,
  existing,
  onDone,
}: {
  projectId: number;
  row?: DocumentRow;
  existing: ResourceOption[];
  onDone: Done;
}) {
  const [mode, setMode] = useState<"new" | "link">("new");
  const canLink = !row && existing.length > 0;
  return (
    <ActionForm
      action={saveDocumentAction}
      hidden={{ project_id: projectId, resource_id: row?.resource_id }}
      submitLabel={row ? "Save" : mode === "link" ? "Link document" : "Add document"}
      onDone={onDone}
    >
      {canLink && (
        <div className="flex gap-1.5">
          {(["new", "link"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                mode === m ? "border-iica-700 bg-iica-700 text-white" : "border-ink/12 bg-white text-ink/70 hover:bg-iica-50"
              }`}
            >
              {m === "new" ? "Register a new document" : "Link one already registered"}
            </button>
          ))}
        </div>
      )}

      {mode === "link" && canLink ? (
        <Field label="Document" hint="Shared documents stay one record, linked to each project that uses it.">
          {(id) => (
            <select id={id} name="existing_resource_id" className="field" required defaultValue="">
              <option value="" disabled>
                Choose a document
              </option>
              {existing.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.resource_type ? ` (${r.resource_type})` : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <>
          <Field label="Title">
            {(id) => <input id={id} name="title" className="field" defaultValue={row?.title ?? ""} required />}
          </Field>
          <Field label="Link" hint="SharePoint, OneDrive or any web address where the file lives.">
            {(id) => <input id={id} name="url" type="url" className="field" defaultValue={row?.url ?? ""} placeholder="https://" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type">
              {(id) => (
                <select id={id} name="resource_type" className="field" defaultValue={row?.resource_type ?? ""}>
                  <option value="">Not set</option>
                  {RESOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Version">
              {(id) => <input id={id} name="version_label" className="field" defaultValue={row?.version_label ?? ""} placeholder="v1.0" maxLength={30} />}
            </Field>
            <Field label="Approval">
              {(id) => (
                <select id={id} name="approval_state" className="field" defaultValue={row?.approval_state ?? "DRAFT"}>
                  {APPROVAL_STATES.map((s) => (
                    <option key={s} value={s}>
                      {APPROVAL_META[s].label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </>
      )}
      <Field label="Why it's linked" hint="For example: evidence, output, reference.">
        {(id) => <input id={id} name="link_purpose" className="field" defaultValue={row?.link_purpose ?? ""} maxLength={100} />}
      </Field>
    </ActionForm>
  );
}

/* ---------- lessons ---------- */

export function LessonForm({
  projectId,
  row,
  todayKey,
  onDone,
}: {
  projectId: number;
  row?: ProjectLesson;
  todayKey?: string;
  onDone: Done;
}) {
  return (
    <ActionForm action={saveLessonAction} hidden={{ project_id: projectId, id: row?.id }} submitLabel={row ? "Save" : "Record lesson"} onDone={onDone}>
      <Field label="Date">
        {(id) => <input id={id} type="date" name="recorded_on" className="field sm:w-48" defaultValue={row?.recorded_on ?? todayKey ?? astTodayKey()} required />}
      </Field>
      <Field label="What was learned" hint="What worked, what didn't, and what to repeat or change next time.">
        {(id) => <textarea id={id} name="body" rows={5} className="field" defaultValue={row?.body ?? ""} required />}
      </Field>
    </ActionForm>
  );
}

/* ---------- model phase stepper ---------- */

export function PhaseStepper({
  projectId,
  phases,
  currentId,
  canEdit,
}: {
  projectId: number;
  phases: Ref[];
  currentId: number | null;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const current = phases.find((p) => p.id === currentId)?.position ?? 0;

  return (
    <div>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {phases.map((p) => {
          const order = p.position ?? 0;
          const done = current > 0 && order < current;
          const here = p.id === currentId;
          const body = (
            <>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                  here ? "bg-white text-iica-800" : done ? "bg-iica-600 text-white" : "bg-ink/8 text-ink/60"
                }`}
              >
                {done ? <Check size={12} aria-hidden="true" /> : order}
              </span>
              <span className="line-clamp-2 text-left text-[11px] font-semibold leading-snug">{p.name}</span>
            </>
          );
          const cls = `flex h-full w-full items-center gap-2 rounded-xl border px-2.5 py-2 transition ${
            here
              ? "border-iica-700 bg-iica-700 text-white shadow-xs"
              : done
                ? "border-iica-300 bg-iica-50 text-iica-900"
                : "border-ink/10 bg-white text-ink/65"
          }`;
          return (
            <li key={p.id}>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={here}
                  title={here ? "Current phase. Click to clear it." : `Move to phase ${order}`}
                  onClick={() => {
                    setError(undefined);
                    start(async () => {
                      const res = await setProjectPhaseAction(projectId, here ? null : p.id);
                      if (res.error) setError(res.error);
                    });
                  }}
                  className={`${cls} ${here ? "" : "hover:border-iica-300 hover:bg-iica-50"} disabled:opacity-60`}
                >
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
