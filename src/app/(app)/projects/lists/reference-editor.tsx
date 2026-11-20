"use client";

import { Plus, Trash2 } from "lucide-react";
import { IconButton, RowActions } from "@/components/icon-button";
import type { RefOption } from "@/lib/projects";
import { REFERENCE_META, type ReferenceKind } from "@/lib/project-meta";
import { deleteReferenceAction, saveReferenceAction } from "../actions";
import { ActionForm, EditIcon, Field, FormModalButton } from "../project-ui";

function EntryForm({ kind, row, onDone }: { kind: ReferenceKind; row?: RefOption; onDone: () => void }) {
  const meta = REFERENCE_META[kind];
  return (
    <ActionForm action={saveReferenceAction} hidden={{ kind, id: row?.id }} submitLabel={row ? "Save" : `Add ${meta.noun}`} onDone={onDone}>
      <div
        className={`grid gap-3 ${
          kind === "phase" ? "" : kind === "tag" ? "sm:grid-cols-[1fr_10rem_6.5rem]" : "sm:grid-cols-[1fr_7rem]"
        }`}
      >
        <Field label="Name">
          {(id) => <input id={id} name="name" className="field" required defaultValue={row?.name ?? ""} maxLength={200} />}
        </Field>
        {kind === "tag" && (
          <Field label="Category">
            {(id) => <input id={id} name="category" className="field" defaultValue={row?.category ?? ""} placeholder="Topic, place…" maxLength={50} />}
          </Field>
        )}
        {kind !== "phase" && (
          <Field label="Order" hint="Lower comes first">
            {(id) => <input id={id} name="position" type="number" min={0} max={999} className="field" defaultValue={row?.position ?? 0} />}
          </Field>
        )}
      </div>
      <Field label="Definition" hint="When this value applies, so everyone uses it the same way.">
        {(id) => <textarea id={id} name="definition" rows={3} className="field" defaultValue={row?.definition ?? ""} />}
      </Field>
      {kind === "status" && (
        <label className="flex items-center gap-2 text-sm text-ink/80">
          <input type="checkbox" name="is_closed" defaultChecked={row?.is_closed ?? false} className="h-4 w-4 rounded border-ink/30" />
          Counts as finished (completed, closed or cancelled)
        </label>
      )}
    </ActionForm>
  );
}

export function ReferenceEditor({ kind, rows }: { kind: ReferenceKind; rows: RefOption[] }) {
  const meta = REFERENCE_META[kind];
  const renderActions = (r: RefOption) => (
    <RowActions>
      <FormModalButton
        title={`Edit ${meta.noun}`}
        trigger={(open) => <EditIcon label={`Edit ${r.name}`} onClick={open} />}
        render={(close) => <EntryForm kind={kind} row={r} onDone={close} />}
      />
      {!meta.fixedCount && (
        <FormModalButton
          title={`Remove ${meta.noun}`}
          description={r.name}
          width="max-w-md"
          trigger={(open) => (
            <IconButton
              label={r.usage > 0 ? `${r.name} is in use (${r.usage})` : `Remove ${r.name}`}
              tone="danger"
              onClick={open}
              disabled={r.usage > 0}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
          render={(close) => (
            <ActionForm action={deleteReferenceAction} hidden={{ kind, id: r.id }} submitLabel="Remove" pendingLabel="Removing…" danger onDone={close}>
              <p className="text-sm text-ink/75">This entry isn&apos;t used by any project, so it can be removed.</p>
            </ActionForm>
          )}
        />
      )}
    </RowActions>
  );
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-ink">{meta.label}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-ink/60">{meta.description}</p>
        </div>
        {!meta.fixedCount && (
          <FormModalButton
            title={`Add ${meta.noun}`}
            trigger={(open) => (
              <button type="button" className="btn btn-primary" onClick={open}>
                <Plus size={15} /> Add {meta.noun}
              </button>
            )}
            render={(close) => <EntryForm kind={kind} onDone={close} />}
          />
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink/60">Nothing here yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-ink/8 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-ink/6 px-1.5 py-0.5 text-[11px] font-semibold text-ink/65 tabular-nums">
                      {kind === "phase" ? `Step ${r.position}` : `#${r.position}`}
                    </span>
                    <span className="text-sm font-medium text-ink">
                      {r.category && <span className="text-ink/60">{r.category} · </span>}
                      {r.name}
                    </span>
                    {r.is_closed && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Finished
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink/70">
                    {r.definition ?? <span className="text-ink/60">No definition yet</span>}
                  </p>
                  <div className="mt-1 text-[11px] text-ink/60 tabular-nums">In use: {r.usage}</div>
                </div>
                {renderActions(r)}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3">
              <thead>
                <tr>
                  <th className="w-14">{kind === "phase" ? "Step" : "Order"}</th>
                  <th>Name</th>
                  <th>Definition</th>
                  <th className="text-right">In use</th>
                  <th className="w-24">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs text-ink/60 tabular-nums">{r.position}</td>
                    <td className="text-sm font-medium text-ink">
                      {r.category && <span className="text-ink/60">{r.category} · </span>}
                      {r.name}
                      {r.is_closed && (
                        <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Finished
                        </span>
                      )}
                    </td>
                    <td className="min-w-[16rem] text-xs text-ink/70">{r.definition ?? <span className="text-ink/60">No definition yet</span>}</td>
                    <td className="text-right text-xs tabular-nums text-ink/70">{r.usage}</td>
                    <td>{renderActions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
