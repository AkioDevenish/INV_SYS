"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { Modal } from "@/components/modal";

export type ExportDataset = {
  key: string;
  label: string;
  hint: string;
  /** Only shown when the signed-in person is allowed to export it. */
  allowed: boolean;
};

export type ExportGroup = { id: number; name: string; count?: number };

const FORMATS = [
  {
    key: "xlsx",
    label: "Excel workbook",
    hint: ".xlsx",
    multiHint: "One sheet per table",
    icon: FileSpreadsheet,
  },
  { key: "csv", label: "CSV", hint: ".csv", multiHint: "Tables stacked in one file", icon: FileText },
  { key: "json", label: "JSON", hint: ".json", multiHint: "Keyed by table", icon: FileJson },
] as const;

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return fallback;
    }
  }
  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || fallback;
}

/**
 * The advanced export: choose which tables, narrow the directory to particular
 * groups, and pick a format. Everything is fetched into a Blob on demand so
 * server errors can be surfaced cleanly before closing.
 */
export function ExportDialog({
  datasets,
  groups,
  defaultDataset,
  filterParams,
  title = "Export data",
  description = "Choose what to include, narrow it down, and pick a format.",
}: {
  /**
   * What this screen is allowed to offer. A section exports its own data - the
   * Directory offers contacts, Inventory offers items. Only the dashboard, which
   * belongs to no single section, passes the full set.
   */
  datasets: ExportDataset[];
  groups: ExportGroup[];
  defaultDataset: string;
  /** Optional active route filter params forwarded to `/api/export`. */
  filterParams?: Record<string, string | undefined>;
  title?: string;
  description?: string;
}) {
  const available = useMemo(() => datasets.filter((d) => d.allowed), [datasets]);
  const allowedKeys = useMemo(() => new Set(available.map((d) => d.key)), [available]);

  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(() => {
    if (available.some((d) => d.key === defaultDataset)) return [defaultDataset];
    return available.length > 0 ? [available[0].key] : [];
  });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [format, setFormat] = useState<string>("xlsx");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // With one table there is nothing to choose, so pin it directly and hide the picker.
  const single = available.length === 1;
  const effectiveChosen = useMemo(() => {
    if (single) return [available[0].key];
    return chosen.filter((key) => allowedKeys.has(key));
  }, [available, allowedKeys, chosen, single]);

  const stakeholdersChosen = effectiveChosen.includes("stakeholders");

  const href = useMemo(() => {
    const params = new URLSearchParams();
    params.set("datasets", effectiveChosen.join(","));
    params.set("format", format);
    if (stakeholdersChosen && groupIds.length > 0) params.set("groups", groupIds.join(","));
    if (filterParams) {
      for (const [key, value] of Object.entries(filterParams)) {
        if (value && key !== "datasets" && key !== "format" && key !== "groups") {
          params.set(key, value);
        }
      }
    }
    return `/api/export?${params.toString()}`;
  }, [effectiveChosen, filterParams, format, groupIds, stakeholdersChosen]);

  if (available.length === 0) return null;

  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );

  const toggleGroup = (id: number) =>
    setGroupIds((current) =>
      current.includes(id) ? current.filter((g) => g !== id) : [...current, id],
    );

  const openModal = () => {
    setError(null);
    setOpen(true);
  };

  const closeModal = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDownloading(false);
    setError(null);
    setOpen(false);
  };

  const handleDownload = async () => {
    if (effectiveChosen.length === 0 || downloading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin", signal: controller.signal });
      if (!res.ok) {
        const message = (await res.text().catch(() => "")).trim();
        setError(message ? message.slice(0, 220) : "Export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      const filename = filenameFromDisposition(
        res.headers.get("content-disposition"),
        `iica-tt-export.${format}`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      setError("Could not reach the export service. Please try again.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setDownloading(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={openModal}>
        <Download size={15} aria-hidden="true" /> Export
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        title={title}
        description={description}
      >
        <div className="space-y-5">
          {!single && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="label">Tables to include</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {available.map((d) => {
                  const on = effectiveChosen.includes(d.key);
                  return (
                    <label
                      key={d.key}
                      className={`cursor-pointer rounded-xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-iica-600/35 ${
                        on
                          ? "border-iica-600 bg-iica-50"
                          : "border-ink/15 bg-white hover:border-iica-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={on}
                        onChange={() => toggle(d.key)}
                      />
                      <div className="text-sm font-medium text-ink">{d.label}</div>
                      <div className="mt-0.5 text-xs leading-snug text-ink/65">{d.hint}</div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {stakeholdersChosen && groups.length > 0 && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="label float-left mb-1.5">Stakeholder groups</legend>
              <button
                type="button"
                className="float-right mb-1.5 rounded text-xs font-medium text-iica-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
                onClick={() =>
                  setGroupIds((current) =>
                    current.length === groups.length ? [] : groups.map((g) => g.id),
                  )
                }
              >
                {groupIds.length === groups.length ? "Clear all" : "Select all"}
              </button>

              {/* An aligned two-column list rather than wrapped pills: the names
                  are long and of wildly different lengths, so pills left a
                  ragged edge and an odd scroll area. */}
              <div className="clear-both max-h-56 overflow-y-auto rounded-xl border border-ink/10">
                <div className="grid sm:grid-cols-2">
                  {groups.map((g, index) => {
                    const on = groupIds.includes(g.id);
                    const hasRightBorder = index % 2 === 0 && index + 1 < groups.length;
                    return (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-center gap-2.5 border-b border-ink/8 px-3 py-2 text-sm transition hover:bg-iica-50 has-[:focus-visible]:bg-iica-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-iica-600/35 ${
                          hasRightBorder ? "sm:border-r" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={on}
                          onChange={() => toggleGroup(g.id)}
                        />
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                            on
                              ? "border-iica-600 bg-iica-600 text-white"
                              : "border-ink/25 bg-white"
                          }`}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink/85">{g.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-ink/65">
                          {g.count ?? ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <p className="mt-1.5 text-xs text-ink/65">
                {groupIds.length === 0
                  ? "Nothing selected, so every group is included."
                  : `${groupIds.length} of ${groups.length} groups selected.`}
              </p>
            </fieldset>
          )}

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="label">Format</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {FORMATS.map(({ key, label, hint, multiHint, icon: Icon }) => {
                const on = format === key;
                return (
                  <label
                    key={key}
                    className={`cursor-pointer rounded-xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-iica-600/35 ${
                      on
                        ? "border-iica-600 bg-iica-50"
                        : "border-ink/15 bg-white hover:border-iica-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="format"
                      className="peer sr-only"
                      checked={on}
                      onChange={() => setFormat(key)}
                    />
                    <Icon size={16} aria-hidden="true" className={on ? "text-iica-700" : "text-ink/65"} />
                    <div className="mt-1.5 text-sm font-medium text-ink">{label}</div>
                    <div className="text-xs leading-snug text-ink/65">
                      {single ? hint : multiHint}
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 pt-4">
            <p className="text-xs text-ink/65">
              {effectiveChosen.length === 0
                ? "Choose at least one table."
                : single
                  ? stakeholdersChosen && groupIds.length > 0
                    ? `${groupIds.length} group${groupIds.length === 1 ? "" : "s"} selected`
                    : "Everything currently in this section"
                  : `${effectiveChosen.length} table${effectiveChosen.length === 1 ? "" : "s"}${
                      stakeholdersChosen && groupIds.length > 0
                        ? `, ${groupIds.length} group${groupIds.length === 1 ? "" : "s"}`
                        : ""
                    }`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
                disabled={effectiveChosen.length === 0 || downloading}
                aria-busy={downloading}
                onClick={handleDownload}
                className="btn btn-primary"
              >
                <Download size={15} aria-hidden="true" /> {downloading ? "Preparing…" : "Download"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
