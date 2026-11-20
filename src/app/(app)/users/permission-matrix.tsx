"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { RoleBadge } from "@/components/role-badge";
import { PERMISSION_COPY, PERMISSION_GROUPS } from "@/lib/permission-copy";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isLocked,
  type Permission,
  type PermissionMatrix,
  type Role,
} from "@/lib/roles";
import {
  resetPermissionsAction,
  savePermissionsAction,
  type MatrixState,
} from "./permission-actions";

function SaveButton({ dirty, onClick }: { dirty: boolean; onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" onClick={onClick} className="btn btn-primary" disabled={pending || !dirty}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
      {pending ? "Saving…" : "Save permissions"}
    </button>
  );
}

function ConfirmResetButton({ onClick }: { onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" onClick={onClick} className="btn btn-danger" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
      {pending ? "Resetting…" : "Restore defaults"}
    </button>
  );
}

function key(role: Role, permission: Permission) {
  return `${role}:${permission}`;
}

function serializeSet(set: Set<string>) {
  return [...set].sort().join("|");
}

export function PermissionMatrixEditor({
  matrix,
  editable,
  roleUserCounts = {},
  onDirtyChange,
}: {
  matrix: PermissionMatrix;
  editable: boolean;
  roleUserCounts?: Partial<Record<Role, number>>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saveState, save] = useActionState<MatrixState, FormData>(savePermissionsAction, {});
  const [resetState, reset] = useActionState<MatrixState, FormData>(resetPermissionsAction, {});
  const [lastAction, setLastAction] = useState<"save" | "reset" | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Held locally so the Save button can tell whether anything actually moved.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(ROLES.flatMap((r) => matrix[r].map((p) => key(r, p)))),
  );

  const initialKey = useMemo(
    () => serializeSet(new Set(ROLES.flatMap((r) => matrix[r].map((p) => key(r, p))))),
    [matrix],
  );
  const defaultsKey = useMemo(
    () =>
      serializeSet(
        new Set(ROLES.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r].map((p) => key(r, p)))),
      ),
    [],
  );

  const currentKey = serializeSet(checked);
  const dirty = currentKey !== initialKey;
  const isAtDefaults = !dirty && initialKey === defaultsKey;

  useEffect(() => {
    setChecked(new Set(ROLES.flatMap((r) => matrix[r].map((p) => key(r, p)))));
  }, [matrix]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (lastAction === "reset" && resetState.ok) {
      setConfirmResetOpen(false);
    }
  }, [lastAction, resetState]);

  const toggle = (role: Role, permission: Permission) => {
    setChecked((current) => {
      const next = new Set(current);
      const id = key(role, permission);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const message =
    lastAction === "reset"
      ? resetState.saved
      : lastAction === "save"
        ? saveState.saved
        : undefined;
  const error =
    lastAction === "reset"
      ? resetState.error
      : lastAction === "save"
        ? saveState.error
        : undefined;

  return (
    <>
      <form action={save}>
        <div className="overflow-x-auto">
          <table className="table-shell min-w-[760px]">
            <thead>
              <tr>
                <th>Permission</th>
                {ROLES.map((role) => {
                  const enabledCount = PERMISSIONS.filter((p) => checked.has(key(role, p))).length;
                  const userCount = roleUserCounts[role];
                  return (
                    <th key={role} className="text-center">
                      <div>{ROLE_LABELS[role]}</div>
                      <div className="mt-0.5 text-[10px] font-medium tracking-normal normal-case text-ink/55">
                        {enabledCount}/{PERMISSIONS.length} allowed
                        {userCount !== undefined
                          ? ` · ${userCount} ${userCount === 1 ? "user" : "users"}`
                          : ""}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.flatMap((group) => [
                <tr key={`group-${group.title}`} className="bg-iica-50/70">
                  <td colSpan={ROLES.length + 1} className="py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iica-800">
                      {group.title}
                    </div>
                    <div className="text-xs text-ink/55">{group.note}</div>
                  </td>
                </tr>,
                ...group.permissions.map((permission) => (
                  <tr key={permission} className="align-top">
                    <td>
                      <div className="font-semibold text-ink">{PERMISSION_COPY[permission].label}</div>
                      <div className="mt-0.5 max-w-md text-xs leading-relaxed text-ink/60">
                        {PERMISSION_COPY[permission].grants}
                      </div>
                    </td>
                    {ROLES.map((role) => {
                      const id = key(role, permission);
                      const on = checked.has(id);
                      const locked = isLocked(role, permission);
                      const labelText = `${PERMISSION_COPY[permission].label} for ${ROLE_LABELS[role]}`;

                      if (!editable) {
                        return (
                          <td key={role} className="text-center">
                            {on ? (
                              <span className="text-iica-700" aria-label="Allowed">
                                ●
                              </span>
                            ) : (
                              <span className="text-ink/25" aria-label="Not allowed">
                                -
                              </span>
                            )}
                          </td>
                        );
                      }

                      return (
                        <td key={role} className="text-center">
                          {/* The checkbox is the input; the label makes the whole
                              cell a comfortable tap target on a phone. */}
                          <label
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition focus-within:ring-2 focus-within:ring-iica-600/40 focus-within:ring-offset-1 ${
                              locked
                                ? "cursor-not-allowed border-ink/10 bg-ink/[0.04]"
                                : on
                                  ? "cursor-pointer border-iica-600 bg-iica-600 text-white hover:bg-iica-700"
                                  : "cursor-pointer border-ink/15 bg-white hover:border-iica-400 hover:bg-iica-50"
                            }`}
                            title={
                              locked
                                ? "Administrators must keep this, or nobody could edit permissions again."
                                : `${on ? "Remove" : "Grant"} ${labelText}`
                            }
                          >
                            <input
                              type="checkbox"
                              name="cell"
                              value={id}
                              aria-label={labelText}
                              className="sr-only"
                              checked={on}
                              disabled={locked}
                              onChange={() => toggle(role, permission)}
                            />
                            {locked ? (
                              <Check size={15} className="text-iica-700/50" aria-hidden="true" />
                            ) : on ? (
                              <Check size={15} aria-hidden="true" />
                            ) : (
                              <span className="text-ink/25" aria-hidden="true">
                                -
                              </span>
                            )}
                          </label>
                          {/* A disabled checkbox posts nothing, so the locked cell
                              is submitted alongside it. */}
                          {locked && <input type="hidden" name="cell" value={id} />}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>

        {editable && (
          <div className="flex flex-col gap-3 border-t border-ink/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs leading-relaxed text-ink/55">
              {error ? (
                <span role="alert" className="flex items-center gap-1.5 text-rose-700">
                  <AlertCircle size={14} className="shrink-0" /> {error}
                </span>
              ) : dirty ? (
                "Unsaved changes. Nothing is enforced until you save."
              ) : (
                message ?? "Changes apply immediately, to everyone, on their next page load."
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={isAtDefaults}
                onClick={() => setConfirmResetOpen(true)}
              >
                <RotateCcw size={15} />
                Reset to defaults
              </button>
              <SaveButton dirty={dirty} onClick={() => setLastAction("save")} />
            </div>
          </div>
        )}

        {/* A plain-language read of the same matrix, so nobody has to trace a
            column of ticks to answer "what can a Viewer actually do?". These
            follow the tick boxes live, before saving. */}
        <div className="grid gap-3 border-t border-ink/8 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((role) => {
            const can = PERMISSIONS.filter((p) => checked.has(key(role, p)));
            const cannot = PERMISSIONS.filter((p) => !checked.has(key(role, p)));
            const userCount = roleUserCounts[role];
            const noInventory = !checked.has(key(role, "inventory.view"));
            return (
              <div key={role} className="rounded-xl border border-ink/8 bg-iica-50/45 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <RoleBadge role={role} />
                  {userCount !== undefined && (
                    <span className="rounded-full border border-ink/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-ink/60 tabular-nums">
                      {userCount} {userCount === 1 ? "user" : "users"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink/60">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
                {can.length > 0 && noInventory && (
                  <p className="mt-1.5 text-[11px] leading-snug text-gold-700">
                    No Dashboard access — opens their first permitted workspace section.
                  </p>
                )}

                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800">
                    Can ({can.length})
                  </div>
                  {can.length === 0 ? (
                    <p className="text-xs text-ink/55">Nothing. This level lands on Profile only.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {can.map((p) => (
                        <li key={p} className="flex gap-1.5 text-xs leading-snug text-ink/70">
                          <Check size={12} className="mt-0.5 shrink-0 text-emerald-700" />
                          {PERMISSION_COPY[p].label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {cannot.length > 0 && (
                  <div className="mt-2.5 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700">
                      Cannot ({cannot.length})
                    </div>
                    <ul className="space-y-0.5">
                      {cannot.map((p) => (
                        <li key={p} className="flex gap-1.5 text-xs leading-snug text-ink/55">
                          <X size={12} className="mt-0.5 shrink-0 text-rose-600/70" />
                          {PERMISSION_COPY[p].label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </form>

      <Modal
        open={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Restore default permissions?"
        width="max-w-md"
      >
        <p className="mb-4 text-sm leading-relaxed text-ink/65">
          This replaces custom permission settings across all four access levels with the built-in
          defaults and discards any unsaved edits on screen.
        </p>
        {resetState.error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{resetState.error}</span>
          </div>
        )}
        <form action={reset} className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirmResetOpen(false)}
          >
            Cancel
          </button>
          <ConfirmResetButton onClick={() => setLastAction("reset")} />
        </form>
      </Modal>
    </>
  );
}
