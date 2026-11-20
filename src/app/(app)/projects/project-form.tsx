"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteProjectAction, saveProjectAction } from "./actions";
import { ActionForm, Field, FormModalButton } from "./project-ui";

export type RefLite = { id: number; name: string; category?: string | null; position?: number };

export type ProjectRefs = {
  statuses: RefLite[];
  phases: RefLite[];
  fundingStatuses: RefLite[];
  areas: RefLite[];
  tags: RefLite[];
};

export type EditableProject = {
  id: number;
  code: string | null;
  title: string;
  purpose: string | null;
  outcome_summary: string | null;
  status_id: number;
  model_phase_id: number | null;
  funding_status_id: number | null;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  areas: { id: number }[];
  tags: { id: number }[];
};

function TogglePills({
  name,
  options,
  initial,
  empty,
  labelledBy,
}: {
  name: string;
  options: RefLite[];
  initial: number[];
  empty: string;
  labelledBy?: string;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set(initial));
  if (options.length === 0) return <p className="text-xs text-ink/60">{empty}</p>;
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = picked.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(o.id)) next.delete(o.id);
                else next.add(o.id);
                return next;
              })
            }
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              on
                ? "border-iica-700 bg-iica-700 text-white"
                : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50"
            }`}
          >
            {o.category ? <span className={on ? "text-white/80" : "text-ink/60"}>{o.category} · </span> : null}
            {o.name}
          </button>
        );
      })}
      {[...picked].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </div>
  );
}

function ProjectFields({ project, refs }: { project?: EditableProject; refs: ProjectRefs }) {
  const defaultStatus = project?.status_id ?? refs.statuses[0]?.id ?? "";
  const areasLabelId = useId();
  const tagsLabelId = useId();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label="Project title">
          {(id) => (
            <input id={id} name="title" className="field" required defaultValue={project?.title ?? ""} maxLength={300} />
          )}
        </Field>
        <Field label="Project code" hint="Optional, must be unique">
          {(id) => <input id={id} name="code" className="field" defaultValue={project?.code ?? ""} maxLength={50} />}
        </Field>
      </div>

      <Field label="Purpose" hint="The need or objective this project addresses.">
        {(id) => (
          <textarea id={id} name="purpose" rows={3} className="field" defaultValue={project?.purpose ?? ""} />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Operational status" hint="Required">
          {(id) => (
            <select id={id} name="status_id" className="field" defaultValue={defaultStatus} required>
              {refs.statuses.length === 0 && (
                <option value="" disabled>
                  No statuses configured
                </option>
              )}
              {refs.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="IICA model phase" hint="Separate from status">
          {(id) => (
            <select id={id} name="model_phase_id" className="field" defaultValue={project?.model_phase_id ?? ""}>
              <option value="">Not assigned yet</option>
              {refs.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.position}. {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Overall funding status" hint="Chosen by staff, not calculated">
          {(id) => (
            <select id={id} name="funding_status_id" className="field" defaultValue={project?.funding_status_id ?? ""}>
              <option value="">Not set</option>
              {refs.fundingStatuses.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start date">
          {(id) => <input id={id} type="date" name="start_date" className="field" defaultValue={project?.start_date ?? ""} />}
        </Field>
        <Field label="Target end date">
          {(id) => (
            <input id={id} type="date" name="target_end_date" className="field" defaultValue={project?.target_end_date ?? ""} />
          )}
        </Field>
        <Field label="Actual end date">
          {(id) => (
            <input id={id} type="date" name="actual_end_date" className="field" defaultValue={project?.actual_end_date ?? ""} />
          )}
        </Field>
      </div>

      <div>
        <div id={areasLabelId} className="label">
          Programme areas
        </div>
        <TogglePills
          name="area_ids"
          options={refs.areas}
          initial={project?.areas.map((a) => a.id) ?? []}
          empty="No programme areas yet. Add them under Reference lists."
          labelledBy={areasLabelId}
        />
      </div>

      <div>
        <div id={tagsLabelId} className="label">
          Tags
        </div>
        <TogglePills
          name="tag_ids"
          options={refs.tags}
          initial={project?.tags.map((t) => t.id) ?? []}
          empty="No tags yet. Add them under Reference lists."
          labelledBy={tagsLabelId}
        />
      </div>

      {project && (
        <Field label="Outcome summary" hint="The result or output, once known.">
          {(id) => (
            <textarea id={id} name="outcome_summary" rows={3} className="field" defaultValue={project.outcome_summary ?? ""} />
          )}
        </Field>
      )}
    </>
  );
}

export function NewProjectButton({ refs }: { refs: ProjectRefs }) {
  const router = useRouter();
  return (
    <FormModalButton
      title="New project"
      description="Create the project record. People, funding and updates are added on its page."
      trigger={(open) => (
        <button type="button" className="btn btn-primary" onClick={open}>
          <Plus size={15} /> New project
        </button>
      )}
      render={(close) => (
        <ActionForm
          action={saveProjectAction}
          submitLabel="Create project"
          onDone={(state) => {
            close();
            if (state.id) router.push(`/projects/${state.id}`);
          }}
        >
          <ProjectFields refs={refs} />
        </ActionForm>
      )}
    />
  );
}

export function EditProjectButton({ project, refs }: { project: EditableProject; refs: ProjectRefs }) {
  return (
    <FormModalButton
      title="Edit project"
      description={project.title}
      trigger={(open) => (
        <button type="button" className="btn btn-ghost" onClick={open}>
          <Pencil size={15} /> Edit
        </button>
      )}
      render={(close) => (
        <ActionForm action={saveProjectAction} hidden={{ id: project.id }} submitLabel="Save changes" onDone={close}>
          <ProjectFields project={project} refs={refs} />
        </ActionForm>
      )}
    />
  );
}

export function DeleteProjectButton({ id, title }: { id: number; title: string }) {
  const router = useRouter();
  return (
    <FormModalButton
      title="Delete project"
      description={title}
      width="max-w-md"
      trigger={(open) => (
        <button type="button" className="btn btn-danger" onClick={open}>
          <Trash2 size={15} /> Delete
        </button>
      )}
      render={(close) => (
        <ActionForm
          action={deleteProjectAction}
          hidden={{ id }}
          submitLabel="Delete project"
          pendingLabel="Deleting…"
          danger
          onDone={(state) => {
            close();
            if (state.ok) router.push("/projects");
          }}
        >
          <p className="text-sm text-ink/75">
            Only a project with no people, funding, updates, actions or lessons can be deleted. Projects with history
            should be set to Closed or Cancelled instead, so the record is kept.
          </p>
        </ActionForm>
      )}
    />
  );
}
