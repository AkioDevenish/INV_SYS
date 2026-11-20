"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Upload } from "lucide-react";
import { Modal } from "@/components/modal";
import { importInventoryAction, type ImportState } from "./actions";

const COLUMN_LABELS: Record<string, string> = {
  description: "Description",
  supplier: "Supplier",
  category_id: "Category",
  location_id: "Location",
  unit_cost: "Unit cost",
  min_quantity: "Minimum",
  condition_note: "Condition note",
};

function Result({ report }: { report: NonNullable<ImportState["report"]> }) {
  const filled = Object.entries(report.filled);
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Added", report.created],
          ["Filled in", report.enriched],
          ["Already complete", report.unchanged],
        ].map(([label, value]) => (
          <div key={label as string} className="panel-flat p-3 text-center">
            <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink/60">{label}</div>
          </div>
        ))}
      </div>

      {filled.length > 0 && (
        <div>
          <div className="label">Fields filled in</div>
          <div className="flex flex-wrap gap-1.5">
            {filled.map(([column, count]) => (
              <span key={column} className="chip border-iica-500/30 bg-iica-600/10 text-iica-700">
                {COLUMN_LABELS[column] ?? column} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 p-3 text-xs text-gold-700">
          <p className="font-semibold">Workbook notes</p>
          <ul className="mt-1 space-y-0.5">
            {report.warnings.slice(0, 10).map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {(report.unknownCategories.length > 0 || report.unknownLocations.length > 0) && (
        <div className="rounded-xl border border-gold-400/40 bg-gold-400/10 p-3 text-xs text-gold-700">
          <p className="font-semibold">Left blank because the name is not on your lists</p>
          {report.unknownCategories.length > 0 && (
            <p className="mt-1">Categories: {report.unknownCategories.join(", ")}</p>
          )}
          {report.unknownLocations.length > 0 && (
            <p className="mt-1">Locations: {report.unknownLocations.join(", ")}</p>
          )}
          <p className="mt-1.5 opacity-90">
            Add them under Reference lists and run the import again to fill those in.
          </p>
        </div>
      )}

      {report.skipped.length > 0 && (
        <div>
          <div className="label">Skipped rows ({report.skipped.length})</div>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-ink/65">
            {report.skipped.slice(0, 25).map((s) => (
              <li key={s.row}>
                Row {s.row}: {s.reason}
              </li>
            ))}
            {report.skipped.length > 25 && (
              <li className="text-ink/60">and {report.skipped.length - 25} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImportFormBody({
  onClose,
  onReset,
}: {
  onClose: () => void;
  onReset: () => void;
}) {
  const [state, action, pending] = useActionState<ImportState, FormData>(
    importInventoryAction,
    {},
  );

  if (state.report) {
    return (
      <div className="space-y-5">
        <Result report={state.report} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn btn-ghost flex-1" onClick={onReset}>
            Import another file
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="inventory_file">
          Excel workbook
        </label>
        <input
          id="inventory_file"
          type="file"
          name="inventory_file"
          accept=".xlsx"
          className="field text-xs"
          required
        />
        <p className="mt-1.5 text-xs text-ink/60">
          Matched on SKU or asset code. Columns are read by their heading, so a file exported from
          here can be edited and sent straight back.
        </p>
      </div>

      <div className="rounded-xl border border-ink/10 bg-iica-50 p-3 text-xs leading-relaxed text-ink/70">
        <p className="font-semibold text-ink/85">What it will and will not touch</p>
        <p className="mt-1">
          Fills in Description, Supplier, Category, Location, Unit cost, Minimum and Condition note
          where the item currently has none.
        </p>
        <p className="mt-1">
          Leaves quantity, unit and condition alone on items you already hold. Stock levels belong
          to stock movements, so they stay auditable.
        </p>
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

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Reading the workbook…" : "Import"}
        </button>
      </div>
    </form>
  );
}

export function ImportItemsButton() {
  const [open, setOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Upload size={15} /> Import
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Import items from a spreadsheet"
        description="Adds items that are new and fills in blanks on the ones you already have. Nothing that already has a value is changed."
      >
        <ImportFormBody
          key={instanceKey}
          onClose={() => setOpen(false)}
          onReset={() => setInstanceKey((k) => k + 1)}
        />
      </Modal>
    </>
  );
}
