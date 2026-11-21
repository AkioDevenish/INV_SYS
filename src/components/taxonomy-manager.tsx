"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  ArrowUpRight,
  Download,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/ui";
import { IconButton, RowActions } from "@/components/icon-button";
import {
  deleteTaxonomyAction,
  saveTaxonomyAction,
  type TaxonomyKind,
  type TaxonomyState,
} from "@/app/(app)/_actions/taxonomy";
import type { TaxonomyRow } from "@/lib/queries";
import { formatNumber } from "@/lib/format";

const SYSTEM_LOCATION_NAMES = new Set([
  "filling room",
  "cabi",
  "shelf top",
  "second shelf",
  "third shelf",
  "fourth shelf",
  "fifth shelf",
  "bottom shelf",
]);

function isSystemEntry(kind: TaxonomyKind, name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (kind === "location") return SYSTEM_LOCATION_NAMES.has(lower);
  if (kind === "category") return lower === "it equipment";
  return false;
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = FORMULA_PREFIX_RE.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
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

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      Delete
    </button>
  );
}

function DeleteForm({
  kind,
  entry,
  onDone,
  nounLower,
  countNoun,
  scope,
}: {
  kind: TaxonomyKind;
  entry: TaxonomyRow;
  onDone: () => void;
  nounLower: string;
  countNoun: string;
  scope: string;
}) {
  const [state, action] = useActionState<TaxonomyState, FormData>(deleteTaxonomyAction, {});
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state.ok) {
      onDoneRef.current();
    }
  }, [state]);

  return (
    <>
      <p className="text-sm leading-relaxed text-ink/70">
        {entry.item_count
          ? `${formatNumber(entry.item_count)} ${countNoun}${entry.item_count === 1 ? "" : "s"} use this ${nounLower}. They will stay in ${scope} but become unassigned.`
          : `No ${countNoun}s use this ${nounLower}, so nothing else changes.`}
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
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={entry.id} />
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <DeleteSubmit />
      </form>
    </>
  );
}

function EntryForm({
  kind,
  entry,
  onDone,
  nounLower,
}: {
  kind: TaxonomyKind;
  entry?: TaxonomyRow;
  onDone: () => void;
  nounLower: string;
}) {
  const [state, action] = useActionState<TaxonomyState, FormData>(saveTaxonomyAction, {});
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const systemProtected = entry ? isSystemEntry(kind, entry.name) : false;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state.ok) {
      onDoneRef.current();
    }
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <input type="hidden" name="kind" value={kind} />
      {entry && <input type="hidden" name="id" value={entry.id} />}

      <div>
        <label className="label" htmlFor={`name-${entry?.id ?? "new"}`}>
          Name
        </label>
        <input
          id={`name-${entry?.id ?? "new"}`}
          name="name"
          required
          readOnly={systemProtected}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "category" ? "IT equipment" : "Main store - Head office"}
          className={`field ${systemProtected ? "bg-ink/[0.03] text-ink/70" : ""}`}
        />
        {systemProtected && (
          <p className="mt-1.5 text-xs text-ink/60">
            This system-managed name powers Inventory tabs or stock rules and cannot be renamed,
            but its description can still be edited.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor={`description-${entry?.id ?? "new"}`}>
          Description
        </label>
        <textarea
          id={`description-${entry?.id ?? "new"}`}
          name="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          className="field resize-y"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <Submit label={entry ? "Save changes" : `Add ${nounLower}`} />
      </div>
    </form>
  );
}

export function TaxonomyManager({
  kind,
  noun,
  countNoun = "item",
  scope = "the inventory",
  entries,
  canManage,
}: {
  kind: TaxonomyKind;
  noun: string;
  countNoun?: string;
  scope?: string;
  entries: TaxonomyRow[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxonomyRow | null>(null);
  const [deleting, setDeleting] = useState<TaxonomyRow | null>(null);
  const [search, setSearch] = useState("");
  const [usageFilter, setUsageFilter] = useState<"ALL" | "IN_USE" | "EMPTY">("ALL");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const nounLower = noun.toLowerCase();

  const totalLinked = useMemo(
    () => entries.reduce((sum, e) => sum + (e.item_count ?? 0), 0),
    [entries],
  );
  const inUseCount = useMemo(
    () => entries.filter((e) => (e.item_count ?? 0) > 0).length,
    [entries],
  );
  const emptyCount = entries.length - inUseCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (usageFilter === "IN_USE" && (entry.item_count ?? 0) === 0) return false;
      if (usageFilter === "EMPTY" && (entry.item_count ?? 0) > 0) return false;
      if (q) {
        const hay = `${entry.name} ${entry.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, usageFilter]);

  const filteredLinked = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.item_count ?? 0), 0),
    [filtered],
  );
  const filteredInUse = useMemo(
    () => filtered.filter((e) => (e.item_count ?? 0) > 0).length,
    [filtered],
  );
  const filteredEmpty = filtered.length - filteredInUse;
  const isFiltered = Boolean(search.trim() || usageFilter !== "ALL");

  const filterHrefFor = (id: number) => {
    if (kind === "category") return `/inventory?category=${id}`;
    if (kind === "location") return `/inventory?location=${id}`;
    return `/stakeholders?group=${id}`;
  };

  const quickLinkLabel = kind === "stakeholderGroup" ? "View contacts" : "View items";

  const pluralTitle =
    kind === "category"
      ? "Inventory categories"
      : kind === "location"
        ? "Storage locations"
        : "Stakeholder groups";

  const exportCsv = () => {
    const header = ["Name", "Description", `Linked ${countNoun}s`, "Share (%)"];
    const rows = filtered.map((e) => {
      const share = totalLinked > 0 ? Math.round(((e.item_count ?? 0) / totalLinked) * 100) : 0;
      return [e.name, e.description ?? "", String(e.item_count ?? 0), String(share)];
    });
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug =
      kind === "stakeholderGroup"
        ? "stakeholder-groups"
        : kind === "category"
          ? "categories"
          : "locations";
    a.href = url;
    a.download = `tt-delegation-${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4">
      {/* Inline Filter & Action Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[210px] flex-1 sm:w-64 sm:flex-none">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/55"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or description..."
              className="field py-1.5 pr-7 pl-8 text-xs"
              aria-label={`Search ${pluralTitle.toLowerCase()}`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/55 hover:text-ink"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <select
            value={usageFilter}
            onChange={(e) => setUsageFilter(e.target.value as "ALL" | "IN_USE" | "EMPTY")}
            className="field w-auto py-1.5 pr-7 pl-2.5 text-xs"
            aria-label="Filter by usage"
          >
            <option value="ALL">All ({entries.length})</option>
            <option value="IN_USE">In use ({inUseCount})</option>
            <option value="EMPTY">Empty ({emptyCount})</option>
          </select>

          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setUsageFilter("ALL");
              }}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="btn btn-ghost py-2 text-xs"
            disabled={filtered.length === 0}
          >
            <Download size={14} /> Export CSV
          </button>
          {canManage && (
            <button
              type="button"
              className="btn btn-primary py-2 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus size={14} /> New {nounLower}
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Panel */}
      <div className="panel relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">{pluralTitle}</h2>

          <div role="group" aria-label="Display mode" className="flex items-center gap-1">
            {(
              [
                { id: "cards", label: "Cards", icon: <LayoutGrid size={13} aria-hidden="true" /> },
                { id: "table", label: "Table", icon: <Table2 size={13} aria-hidden="true" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={viewMode === tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                  viewMode === tab.id
                    ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                    : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={20} />}
            title={entries.length === 0 ? `No ${nounLower} records yet` : "Nothing matches those filters"}
            description={
              entries.length === 0
                ? canManage
                  ? `Create your first ${nounLower} to start organising ${scope}.`
                  : `An administrator or manager needs to create the first ${nounLower}.`
                : "Try a different search term or clear your filter."
            }
          />
        ) : viewMode === "cards" ? (
          <div key={`cards-${search}-${usageFilter}`} className="animate-fade p-4 sm:p-5">
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => {
                const count = entry.item_count ?? 0;
                const share = totalLinked > 0 ? Math.round((count / totalLinked) * 100) : 0;
                const systemProtected = isSystemEntry(kind, entry.name);
                return (
                  <div
                    key={entry.id}
                    className="flex flex-col justify-between rounded-2xl border border-ink/10 bg-white p-4 transition hover:border-iica-300 hover:bg-iica-50/15"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold leading-snug text-ink">{entry.name}</h3>
                          {systemProtected && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ink/[0.04] px-2 py-0.5 text-[10px] font-medium text-ink/65">
                              <Lock size={10} aria-hidden="true" /> System list
                            </span>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                            count > 0
                              ? "border-iica-200 bg-iica-50 text-iica-800"
                              : "border-ink/12 bg-ink/5 text-ink/60"
                          }`}
                        >
                          {formatNumber(count)} {countNoun}
                          {count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink/60">
                        {entry.description || "No description provided."}
                      </p>

                      {/* Share of linked records progress bar */}
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-ink/60">
                          <span>Share of {scope.replace("the ", "")}</span>
                          <span className="font-semibold text-ink/75 tabular-nums">{share}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
                          <div
                            className="h-full rounded-full bg-iica-700 transition-all duration-300"
                            style={{ width: `${Math.max(share, count > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-ink/8 pt-2.5">
                      <Link
                        href={filterHrefFor(entry.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-iica-700 transition hover:text-iica-900"
                      >
                        {quickLinkLabel} <ArrowUpRight size={13} />
                      </Link>
                      {canManage && (
                        <RowActions>
                          <IconButton onClick={() => setEditing(entry)} label={`Edit ${entry.name}`}>
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton
                            disabled={systemProtected}
                            onClick={() => setDeleting(entry)}
                            label={
                              systemProtected
                                ? `${entry.name} is system-managed and cannot be deleted`
                                : `Delete ${entry.name}`
                            }
                            tone="danger"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </RowActions>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div key={`table-${search}-${usageFilter}`} className="animate-fade overflow-x-auto">
            <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Linked records</th>
                  <th>Share</th>
                  <th>Quick link</th>
                  {canManage && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const count = entry.item_count ?? 0;
                  const share = totalLinked > 0 ? Math.round((count / totalLinked) * 100) : 0;
                  const systemProtected = isSystemEntry(kind, entry.name);
                  return (
                    <tr key={entry.id}>
                      <td className="font-semibold text-ink">
                        <div className="flex items-center gap-2">
                          <span>{entry.name}</span>
                          {systemProtected && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ink/[0.04] px-2 py-0.5 text-[10px] font-medium text-ink/65">
                              <Lock size={10} aria-hidden="true" /> System
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="max-w-sm truncate text-xs text-ink/65">
                        {entry.description || "-"}
                      </td>
                      <td>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                            count > 0
                              ? "border-iica-200 bg-iica-50 text-iica-800"
                              : "border-ink/12 bg-ink/5 text-ink/60"
                          }`}
                        >
                          {formatNumber(count)} {countNoun}
                          {count === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="w-32">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                            <div
                              className="h-full rounded-full bg-iica-700"
                              style={{ width: `${Math.max(share, count > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs font-medium text-ink/65 tabular-nums">
                            {share}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <Link
                          href={filterHrefFor(entry.id)}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-iica-700 hover:underline"
                        >
                          {quickLinkLabel} <ArrowUpRight size={13} />
                        </Link>
                      </td>
                      {canManage && (
                        <td className="text-right">
                          <RowActions>
                            <IconButton onClick={() => setEditing(entry)} label={`Edit ${entry.name}`}>
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              disabled={systemProtected}
                              onClick={() => setDeleting(entry)}
                              label={
                                systemProtected
                                  ? `${entry.name} is system-managed and cannot be deleted`
                                  : `Delete ${entry.name}`
                              }
                              tone="danger"
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </RowActions>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-4 py-3 text-xs text-ink/65 sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex cursor-default items-center rounded-lg border border-iica-200 bg-iica-50 px-2.5 py-0.5 text-[11px] font-medium text-iica-800 select-none">
              In use: {filteredInUse}
            </span>
            <span className="inline-flex cursor-default items-center rounded-lg border border-ink/12 bg-ink/5 px-2.5 py-0.5 text-[11px] font-medium text-ink/65 select-none">
              Empty: {filteredEmpty}
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
            <span>
              {isFiltered ? "Matching" : "Total"}{" "}
              {kind === "stakeholderGroup" ? "groups" : kind === "category" ? "categories" : "locations"}:
            </span>
            <span className="font-semibold text-ink tabular-nums">{filtered.length}</span>
            <span className="text-ink/50">·</span>
            <span className="font-semibold text-ink tabular-nums">
              {formatNumber(filteredLinked)}
            </span>
            <span>
              {countNoun}
              {filteredLinked === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`New ${nounLower}`}
        width="max-w-lg"
      >
        {creating && (
          <EntryForm kind={kind} onDone={() => setCreating(false)} nounLower={nounLower} />
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? ""}`}
        width="max-w-lg"
      >
        {editing && (
          <EntryForm
            key={editing.id}
            kind={kind}
            entry={editing}
            onDone={() => setEditing(null)}
            nounLower={nounLower}
          />
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        width="max-w-md"
      >
        {deleting && (
          <DeleteForm
            key={deleting.id}
            kind={kind}
            entry={deleting}
            onDone={() => setDeleting(null)}
            nounLower={nounLower}
            countNoun={countNoun}
            scope={scope}
          />
        )}
      </Modal>
    </div>
  );
}
