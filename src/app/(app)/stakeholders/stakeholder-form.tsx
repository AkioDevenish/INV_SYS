"use client";

import { useOnChange } from "@/lib/use-synced-state";
import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { IconButton } from "@/components/icon-button";
import {
  createGroupAction,
  deleteStakeholderAction,
  saveStakeholderAction,
  type StakeholderState,
} from "./actions";
import type { StakeholderRow } from "@/lib/queries";

type Group = { id: number; name: string };

function initialWebsiteValue(raw: string | null | undefined): string {
  const val = (raw ?? "").trim();
  if (!val) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(val) || val.startsWith("//")) return val;
  return `https://${val}`;
}

export function safeTelHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const primary = raw.split(/[/;]|ext\.?|x\b/i)[0] ?? "";
  const cleaned = primary.replace(/[^\d+]/g, "");
  const digitCount = cleaned.replace(/\D/g, "").length;
  return digitCount >= 3 ? `tel:${cleaned}` : undefined;
}

/**
 * The group select, with an inline "add" mode. A new group is created straight
 * away and selected, so the contact being filled in is never lost.
 *
 * It cannot be a nested <form> - forms do not nest in HTML - so the add button
 * calls the action directly rather than submitting, and `name="new_group_name"`
 * ensures submitting the outer form while adding still creates & links it.
 */
function GroupSelect({
  groups,
  value,
  onChange,
  canManage,
}: {
  groups: Group[];
  value: number | "";
  onChange: (next: number | "") => void;
  canManage: boolean;
}) {
  const fieldId = useId();
  const [options, setOptions] = useState(groups);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // New groups from the server are merged in, keeping any created here meanwhile.
  useOnChange(groups, (next) => {
    setOptions((current) => {
      const merged = new Map<number, Group>();
      for (const g of next) merged.set(g.id, g);
      for (const g of current) if (!merged.has(g.id)) merged.set(g.id, g);
      return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(undefined);
    const data = new FormData();
    data.set("name", trimmed);
    const result = await createGroupAction({}, data);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.groupId) {
      setOptions((current) =>
        current.some((g) => g.id === result.groupId)
          ? current
          : [...current, { id: result.groupId!, name: trimmed }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
      onChange(result.groupId);
    }
    setName("");
    setAdding(false);
  };

  return (
    <div className="block">
      <label className="label" htmlFor={fieldId}>
        Group
      </label>
      {adding ? (
        <div className="flex gap-1.5">
          <input
            id={fieldId}
            name="new_group_name"
            className="field"
            value={name}
            autoFocus
            placeholder="New group name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
                setName("");
                setError(undefined);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary px-3"
            onClick={() => void create()}
            disabled={busy}
            aria-label="Save group"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          </button>
          <button
            type="button"
            className="btn btn-ghost px-3"
            onClick={() => {
              setAdding(false);
              setName("");
              setError(undefined);
            }}
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <select
            id={fieldId}
            className="field"
            name="group_id"
            value={value}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Ungrouped</option>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {canManage && (
            <button
              type="button"
              className="btn btn-ghost px-3"
              onClick={() => setAdding(true)}
              aria-label="Add a group"
              title="Add a group"
            >
              <Plus size={15} />
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}
      {/* Keeps the fallback value in the form payload while the add box is showing. */}
      {adding && <input type="hidden" name="group_id" value={value} />}
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Saving…" : label}
    </button>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
  multiple = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  multiple?: boolean;
}) {
  const inputId = useId();
  return (
    <div className="block">
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field"
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        multiple={multiple}
      />
    </div>
  );
}

function StakeholderForm({
  stakeholder,
  groups,
  onDone,
}: {
  stakeholder?: StakeholderRow;
  groups: Group[];
  onDone: () => void;
}) {
  const notesId = useId();
  const [state, action] = useActionState<StakeholderState, FormData>(saveStakeholderAction, {});

  const [name, setName] = useState(stakeholder?.name ?? "");
  const [groupId, setGroupId] = useState<number | "">(stakeholder?.group_id ?? "");
  const [organisation, setOrganisation] = useState(stakeholder?.organisation ?? "");
  const [jobTitle, setJobTitle] = useState(stakeholder?.job_title ?? "");
  const [email, setEmail] = useState(stakeholder?.email ?? "");
  const [altEmail, setAltEmail] = useState(stakeholder?.alt_email ?? "");
  const [phone, setPhone] = useState(stakeholder?.phone ?? "");
  const [altPhone, setAltPhone] = useState(stakeholder?.alt_phone ?? "");
  const [location, setLocation] = useState(stakeholder?.location ?? "");
  const [website, setWebsite] = useState(initialWebsiteValue(stakeholder?.website));
  const [gender, setGender] = useState(stakeholder?.gender ?? "");
  const [ageGroup, setAgeGroup] = useState(stakeholder?.age_group ?? "");
  const [social, setSocial] = useState(stakeholder?.social ?? "");
  const [notes, setNotes] = useState(stakeholder?.notes ?? "");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {stakeholder && <input type="hidden" name="id" value={stakeholder.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" value={name} onChange={setName} required />
        <GroupSelect
          groups={groups}
          value={groupId}
          onChange={setGroupId}
          canManage
        />
        <Field
          label="Organisation"
          name="organisation"
          value={organisation}
          onChange={setOrganisation}
        />
        <Field
          label="Job title / role"
          name="job_title"
          value={jobTitle}
          onChange={setJobTitle}
        />
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} />
        <Field
          label="Alternate email"
          name="alt_email"
          type="email"
          multiple
          value={altEmail}
          onChange={setAltEmail}
        />
        <Field label="Phone" name="phone" type="tel" value={phone} onChange={setPhone} />
        <Field
          label="Alternate phone"
          name="alt_phone"
          type="tel"
          value={altPhone}
          onChange={setAltPhone}
        />
        <Field
          label="Location"
          name="location"
          value={location}
          onChange={setLocation}
          placeholder="Town, country or address"
        />
        <Field
          label="Website"
          name="website"
          type="url"
          value={website}
          onChange={setWebsite}
          placeholder="https://example.org"
        />
        <Field label="Gender" name="gender" value={gender} onChange={setGender} />
        <Field label="Age group" name="age_group" value={ageGroup} onChange={setAgeGroup} />
      </div>

      <Field label="Social media" name="social" value={social} onChange={setSocial} />

      <div className="block">
        <label className="label" htmlFor={notesId}>
          Notes
        </label>
        <textarea
          id={notesId}
          className="field"
          name="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <Submit label={stakeholder ? "Save changes" : "Add stakeholder"} />
      </div>
    </form>
  );
}

export function NewStakeholderButton({
  groups,
}: {
  groups: Group[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New stakeholder
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New stakeholder"
        description="Anyone the delegation needs to be able to reach."
      >
        <StakeholderForm groups={groups} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function EditStakeholderButton({
  stakeholder,
  groups,
  icon = false,
}: {
  stakeholder: StakeholderRow;
  groups: Group[];
  /** Row actions are icon-only; the detail page uses the labelled button. */
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon ? (
        <IconButton onClick={() => setOpen(true)} label={`Edit ${stakeholder.name}`}>
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
        title={`Edit ${stakeholder.name}`}
        description="Changes are recorded in the audit trail."
      >
        <StakeholderForm
          stakeholder={stakeholder}
          groups={groups}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      Delete
    </button>
  );
}

function DeleteStakeholderBody({
  id,
  stayOnList,
  onClose,
}: {
  id: number;
  stayOnList: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState<StakeholderState, FormData>(deleteStakeholderAction, {});
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      onClose();
      if (!stayOnList) router.push("/stakeholders");
    }
  }, [state.ok, onClose, stayOnList, router]);

  return (
    <>
      <p className="text-sm leading-relaxed text-ink/60">
        This removes the contact permanently. The deletion itself stays in the audit trail.
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
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <DeleteSubmit />
      </form>
    </>
  );
}

export function DeleteStakeholderButton({
  id,
  name,
  icon = false,
  stayOnList = false,
}: {
  id: number;
  name: string;
  icon?: boolean;
  /** Deleting from the list should not navigate away from the list. */
  stayOnList?: boolean;
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
        title={`Delete ${name}?`}
        width="max-w-md"
      >
        <DeleteStakeholderBody
          id={id}
          stayOnList={stayOnList}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

/**
 * Shared directory table + mobile list with a single Edit modal and Delete
 * modal lifted above all rows (avoids mounting 100 per-row modals).
 */
export function StakeholderDirectoryList({
  people,
  groups,
  canManage,
}: {
  people: StakeholderRow[];
  groups: Group[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<StakeholderRow | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);

  return (
    <>
      {/* Card per contact below lg - six columns will not fit a handset. */}
      <ul className="divide-y divide-ink/8 lg:hidden">
        {people.map((p) => {
          const emailDisplay = p.email ?? p.alt_email;
          const phoneDisplay = p.phone ?? p.alt_phone;
          return (
            <li key={p.id} className="flex items-start gap-1 px-4 py-3.5">
              <Link href={`/stakeholders/${p.id}`} className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{p.name}</div>
                    {p.organisation && (
                      <div className="truncate text-xs text-ink/50">{p.organisation}</div>
                    )}
                  </div>
                  {p.group_name && (
                    <span className="chip shrink-0 border-iica-500/30 bg-iica-600/10 text-iica-700">
                      {p.group_name}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-ink/60">
                  {emailDisplay && <div className="truncate">{emailDisplay}</div>}
                  {phoneDisplay && <div className="tabular-nums">{phoneDisplay}</div>}
                  {!emailDisplay && !phoneDisplay && (
                    <div className="text-ink/40">No contact details on file</div>
                  )}
                </div>
              </Link>
              {canManage && (
                <div className="flex shrink-0 flex-col">
                  <IconButton onClick={() => setEditing(p)} label={`Edit ${p.name}`}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleting({ id: p.id, name: p.name })}
                    label={`Delete ${p.name}`}
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
            <th>Name</th>
            <th>Organisation</th>
            <th className="hidden 2xl:table-cell">Role</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Group</th>
            {canManage && <th className="w-24 text-right">Manage</th>}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const phoneHref = safeTelHref(p.phone);
            return (
              <tr key={p.id}>
                <td>
                  <Link
                    href={`/stakeholders/${p.id}`}
                    className="font-medium text-ink hover:text-iica-700"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="max-w-[180px] truncate text-ink/60">{p.organisation ?? "-"}</td>
                <td className="hidden max-w-[160px] truncate text-ink/55 2xl:table-cell">
                  {p.job_title ?? "-"}
                </td>
                <td className="max-w-[190px] truncate text-ink/60">
                  {p.email ? (
                    <a className="hover:text-iica-700 hover:underline" href={`mailto:${p.email}`}>
                      {p.email}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="whitespace-nowrap text-ink/60">
                  {p.phone ? (
                    phoneHref ? (
                      <a className="hover:text-iica-700 hover:underline" href={phoneHref}>
                        {p.phone}
                      </a>
                    ) : (
                      p.phone
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  {p.group_name ? (
                    <span className="chip max-w-[150px] border-iica-500/30 bg-iica-600/10 text-iica-700">
                      <span className="truncate">{p.group_name}</span>
                    </span>
                  ) : (
                    <span className="text-ink/40">-</span>
                  )}
                </td>
                {canManage && (
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <IconButton onClick={() => setEditing(p)} label={`Edit ${p.name}`}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton
                        onClick={() => setDeleting({ id: p.id, name: p.name })}
                        label={`Delete ${p.name}`}
                        tone="danger"
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : "Edit stakeholder"}
        description="Changes are recorded in the audit trail."
      >
        {editing && (
          <StakeholderForm
            key={editing.id}
            stakeholder={editing}
            groups={groups}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : "Delete stakeholder?"}
        width="max-w-md"
      >
        {deleting && (
          <DeleteStakeholderBody
            key={deleting.id}
            id={deleting.id}
            stayOnList
            onClose={() => setDeleting(null)}
          />
        )}
      </Modal>
    </>
  );
}
