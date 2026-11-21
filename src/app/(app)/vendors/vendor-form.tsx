"use client";

import { useOnChange } from "@/lib/use-synced-state";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Plus,
  ReceiptText,
  Upload,
} from "lucide-react";
import { Modal } from "@/components/modal";
import {
  BILLING_CYCLE_LABELS,
  VENDOR_CATEGORIES,
  VENDOR_GROUPS,
  VENDOR_GROUP_ORDER,
  VENDOR_STATUS_META,
  suggestNextDueDate,
  trinidadTodayKey,
} from "@/lib/vendor-groups";
import type {
  BillingCycle,
  VendorEngagementItem,
  VendorItem,
  VendorStatus,
} from "@/lib/vendors";
import {
  importVendorsAction,
  saveVendorAction,
  saveVendorEngagementAction,
  type VendorState,
} from "./actions";

export type VendorSelectOption = {
  id: number;
  name: string;
  category: string;
  status?: VendorStatus;
  billing_cycle?: BillingCycle | null;
  next_due_date?: string | null;
};

export function VendorFormFields({
  vendor,
  canViewReports = false,
  onSaved,
  onCancel,
}: {
  vendor?: VendorItem | null;
  canViewReports?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(vendor?.id);
  const [state, action, pending] = useActionState<VendorState, FormData>(saveVendorAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;

  useEffect(() => {
    if (!state.ok) return;
    if (!isEdit) ref.current?.reset();
    onSavedRef.current?.();
  }, [state.ok, isEdit]);

  const val = (key: string, fallback: string) => state.values?.[key] ?? fallback;

  return (
    <form
      key={state.attempt ?? 0}
      ref={ref}
      action={action}
      className="space-y-3.5"
    >
      {vendor?.id && <input type="hidden" name="id" value={vendor.id} />}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("name")} className="label">
            Vendor name
          </label>
          <input
            id={fieldId("name")}
            name="name"
            defaultValue={val("name", vendor?.name ?? "")}
            className="field"
            placeholder="Company or provider name"
            required
          />
        </div>
        <div>
          <label htmlFor={fieldId("category")} className="label">
            Category
          </label>
          <input
            id={fieldId("category")}
            name="category"
            list={`${uid}-category-options`}
            defaultValue={val("category", vendor?.category ?? "Caterers")}
            className="field"
            placeholder="Category"
          />
          <datalist id={`${uid}-category-options`}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <div>
        <label htmlFor={fieldId("service")} className="label">
          Service / specialty
        </label>
        <input
          id={fieldId("service")}
          name="service"
          defaultValue={val("service", vendor?.service ?? "")}
          className="field"
          placeholder="Workshop lunches, AC servicing, courier..."
        />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <div>
          <label htmlFor={fieldId("status")} className="label">
            Approval status
          </label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue={val("status", vendor?.status ?? "APPROVED")}
            className="field"
          >
            <option value="PREFERRED">Preferred</option>
            <option value="APPROVED">Approved</option>
            <option value="ON_HOLD">On hold</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("rating")} className="label">
            Internal rating
          </label>
          <select
            id={fieldId("rating")}
            name="rating"
            defaultValue={val(
              "rating",
              isEdit ? (vendor?.rating ? String(vendor.rating) : "") : "4",
            )}
            className="field"
          >
            <option value="">Unrated</option>
            <option value="5">5 / 5 (Excellent)</option>
            <option value="4">4 / 5 (Reliable)</option>
            <option value="3">3 / 5 (Average)</option>
            <option value="2">2 / 5 (Fair)</option>
            <option value="1">1 / 5 (Needs review)</option>
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("price_tier")} className="label">
            Price tier
          </label>
          <select
            id={fieldId("price_tier")}
            name="price_tier"
            defaultValue={val(
              "price_tier",
              isEdit ? (vendor?.price_tier ?? "") : "STANDARD",
            )}
            className="field"
          >
            <option value="">Unspecified</option>
            <option value="BUDGET">Budget</option>
            <option value="STANDARD">Standard</option>
            <option value="PREMIUM">Premium</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("contact_person")} className="label">
            Contact person
          </label>
          <input
            id={fieldId("contact_person")}
            name="contact_person"
            defaultValue={val("contact_person", vendor?.contact_person ?? "")}
            className="field"
            placeholder="Contact name"
          />
        </div>
        <div>
          <label htmlFor={fieldId("phone")} className="label">
            Phone
          </label>
          <input
            id={fieldId("phone")}
            type="tel"
            name="phone"
            defaultValue={val("phone", vendor?.phone ?? "")}
            className="field"
            placeholder="Telephone number"
          />
        </div>
        <div>
          <label htmlFor={fieldId("email")} className="label">
            Email
          </label>
          <input
            id={fieldId("email")}
            type="email"
            name="email"
            defaultValue={val("email", vendor?.email ?? "")}
            className="field"
            placeholder="name@company.com"
          />
        </div>
        <div>
          <label htmlFor={fieldId("website")} className="label">
            Website
          </label>
          <input
            id={fieldId("website")}
            type="url"
            name="website"
            defaultValue={val("website", vendor?.website ?? "")}
            className="field"
            placeholder="https://company.com"
          />
        </div>
        <div>
          <label htmlFor={fieldId("address")} className="label">
            Location / address
          </label>
          <input
            id={fieldId("address")}
            name="address"
            defaultValue={val("address", vendor?.address ?? "")}
            className="field"
            placeholder="Town or street address"
          />
        </div>
        <div>
          <label htmlFor={fieldId("tax_id")} className="label">
            Tax / BIR / VAT ID
          </label>
          <input
            id={fieldId("tax_id")}
            name="tax_id"
            defaultValue={val("tax_id", vendor?.tax_id ?? "")}
            className="field"
            placeholder="Optional tax registration #"
          />
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("payment_terms")} className="label">
            Payment terms
          </label>
          <input
            id={fieldId("payment_terms")}
            name="payment_terms"
            defaultValue={val("payment_terms", vendor?.payment_terms ?? "")}
            className="field"
            placeholder="Net 15, Net 30, or upon delivery"
          />
        </div>
        <div>
          <label htmlFor={fieldId("turnaround")} className="label">
            Turnaround time
          </label>
          <input
            id={fieldId("turnaround")}
            name="turnaround"
            defaultValue={val("turnaround", vendor?.turnaround ?? "")}
            className="field"
            placeholder="24 hours, 3-5 days..."
          />
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <div>
          <label htmlFor={fieldId("contract_status")} className="label">
            Contract type
          </label>
          <select
            id={fieldId("contract_status")}
            name="contract_status"
            defaultValue={val("contract_status", vendor?.contract_status ?? "NONE")}
            className="field text-xs"
          >
            <option value="NONE">As needed</option>
            <option value="ACTIVE_CONTRACT">Active contract</option>
            <option value="RECURRING_UTILITY">Recurring utility</option>
            <option value="RENEWAL_DUE">Renewal due</option>
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("billing_cycle")} className="label">
            Billing cycle
          </label>
          <select
            id={fieldId("billing_cycle")}
            name="billing_cycle"
            defaultValue={val("billing_cycle", vendor?.billing_cycle ?? "")}
            className="field text-xs"
          >
            <option value="">None</option>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="ANNUAL">Annual</option>
            <option value="ON_DEMAND">On demand</option>
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("next_due_date")} className="label">
            Next due date
          </label>
          <input
            id={fieldId("next_due_date")}
            type="date"
            name="next_due_date"
            defaultValue={val("next_due_date", vendor?.next_due_date ?? "")}
            className="field text-xs"
          />
        </div>
      </div>

      {canViewReports && (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={fieldId("estimated_cost")} className="label">
              Est. cost (TTD) (optional)
            </label>
            <input
              id={fieldId("estimated_cost")}
              type="number"
              step="0.01"
              min="0"
              name="estimated_cost"
              defaultValue={val(
                "estimated_cost",
                vendor?.estimated_cost != null ? String(vendor.estimated_cost) : "",
              )}
              className="field text-xs"
              placeholder="0.00"
            />
          </div>
          <div>
            <label htmlFor={fieldId("standard_cost")} className="label">
              Cost / standard rate (TTD) (optional)
            </label>
            <input
              id={fieldId("standard_cost")}
              type="number"
              step="0.01"
              min="0"
              name="standard_cost"
              defaultValue={val(
                "standard_cost",
                vendor?.standard_cost != null ? String(vendor.standard_cost) : "",
              )}
              className="field text-xs"
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor={fieldId("notes")} className="label">
          Notes
        </label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          defaultValue={val("notes", vendor?.notes ?? "")}
          className="field min-h-16"
          placeholder="Account number, delivery notes or special terms"
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {(onCancel || onSaved) && (
          <button
            type="button"
            onClick={onCancel ?? onSaved}
            className="btn btn-ghost w-full sm:w-auto"
          >
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </form>
  );
}

export function EngagementFormFields({
  vendors,
  defaultVendorId,
  engagement,
  staffNames = [],
  canViewReports = false,
  todayKey,
  onSaved,
  onCancel,
}: {
  vendors: VendorSelectOption[];
  defaultVendorId?: number | null;
  engagement?: VendorEngagementItem | null;
  staffNames?: string[];
  canViewReports?: boolean;
  todayKey?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(engagement?.id);
  const [state, action, pending] = useActionState<VendorState, FormData>(
    saveVendorEngagementAction,
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;

  const selectableVendors = useMemo(
    () =>
      vendors.filter(
        (v) =>
          v.status !== "INACTIVE" ||
          v.id === engagement?.vendor_id ||
          v.id === defaultVendorId,
      ),
    [vendors, engagement?.vendor_id, defaultVendorId],
  );

  const initialVendorId =
    state.values?.vendor_id ??
    String(
      engagement?.vendor_id ?? defaultVendorId ?? selectableVendors[0]?.id ?? "",
    );

  const [selectedVendorId, setSelectedVendorId] = useState(initialVendorId);
  const [todayStr] = useState(() => todayKey || trinidadTodayKey());
  const [nextVendorDueInput, setNextVendorDueInput] = useState(
    state.values?.next_vendor_due_date ?? "",
  );

  // Each new result restores what was typed (after an error) or clears the
  // due-date field (after adding), during render rather than in an effect.
  useOnChange(state, (next) => {
    if (next.values?.vendor_id !== undefined) setSelectedVendorId(next.values.vendor_id);
    if (next.values?.next_vendor_due_date !== undefined) {
      setNextVendorDueInput(next.values.next_vendor_due_date);
    }
    if (next.ok && !isEdit) setNextVendorDueInput("");
  });

  // The native form reset and the parent's callback are side effects, so they stay here.
  useEffect(() => {
    if (!state.ok) return;
    if (!isEdit) ref.current?.reset();
    onSavedRef.current?.();
  }, [state, isEdit]);

  const val = (key: string, fallback: string) => state.values?.[key] ?? fallback;

  const selectedVendor = useMemo(
    () => selectableVendors.find((v) => String(v.id) === selectedVendorId) ?? null,
    [selectableVendors, selectedVendorId],
  );

  const suggestedNextDue = useMemo(
    () =>
      suggestNextDueDate(
        selectedVendor?.next_due_date ?? engagement?.engaged_on ?? todayStr,
        selectedVendor?.billing_cycle,
      ),
    [selectedVendor, engagement?.engaged_on, todayStr],
  );

  return (
    <form
      key={state.attempt ?? 0}
      ref={ref}
      action={action}
      className="space-y-3.5"
    >
      {engagement?.id && <input type="hidden" name="id" value={engagement.id} />}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("vendor_id")} className="label">
            Vendor
          </label>
          <select
            id={fieldId("vendor_id")}
            name="vendor_id"
            value={selectedVendorId}
            onChange={(e) => setSelectedVendorId(e.target.value)}
            className="field"
            required
          >
            {selectableVendors.length === 0 ? (
              <option value="" disabled>
                No active vendors available — add a vendor first
              </option>
            ) : (
              selectableVendors.map((v) => {
                const statusTag =
                  v.status === "ON_HOLD" || v.status === "INACTIVE"
                    ? ` — ${VENDOR_STATUS_META[v.status]?.label ?? v.status}`
                    : "";
                return (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.category}){statusTag}
                  </option>
                );
              })
            )}
          </select>
          {selectedVendor?.status === "ON_HOLD" && (
            <p className="mt-1 text-[11px] font-medium text-amber-700">
              Note: This vendor is currently on hold.
            </p>
          )}
          {selectedVendor?.status === "INACTIVE" && (
            <p className="mt-1 text-[11px] font-medium text-rose-700">
              Note: This vendor is marked inactive.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={fieldId("kind")} className="label">
            Record type
          </label>
          <select
            id={fieldId("kind")}
            name="kind"
            defaultValue={val("kind", engagement?.kind ?? "INVOICE")}
            className="field"
          >
            <option value="INVOICE">Invoice</option>
            <option value="QUOTE">Quote</option>
            <option value="PO">Purchase order</option>
            <option value="UTILITY_BILL">Utility bill</option>
            <option value="SERVICE">Maintenance / service</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={fieldId("title")} className="label">
          Description
        </label>
        <input
          id={fieldId("title")}
          name="title"
          defaultValue={val("title", engagement?.title ?? "")}
          className="field"
          placeholder="Monthly utility bill, AC servicing, workshop lunch..."
          required
        />
      </div>

      {canViewReports && (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={fieldId("estimated_cost_ttd")} className="label">
              Est. cost (TTD) (optional)
            </label>
            <input
              id={fieldId("estimated_cost_ttd")}
              type="number"
              step="0.01"
              min="0"
              name="estimated_cost_ttd"
              defaultValue={val(
                "estimated_cost_ttd",
                engagement?.estimated_cost_ttd != null
                  ? String(engagement.estimated_cost_ttd)
                  : "",
              )}
              className="field"
              placeholder="0.00"
            />
          </div>
          <div>
            <label htmlFor={fieldId("amount_ttd")} className="label">
              Cost / amount (TTD) (optional)
            </label>
            <input
              id={fieldId("amount_ttd")}
              type="number"
              step="0.01"
              min="0"
              name="amount_ttd"
              defaultValue={val(
                "amount_ttd",
                engagement?.amount_ttd != null ? String(engagement.amount_ttd) : "",
              )}
              className="field"
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("status")} className="label">
            Payment status
          </label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue={val("status", engagement?.status ?? "PAID")}
            className="field"
          >
            <option value="PAID">Paid</option>
            <option value="PENDING_PAYMENT">Pending payment</option>
            <option value="APPROVED">Approved</option>
            <option value="QUOTED">Quoted</option>
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("reference_no")} className="label">
            Reference / invoice #
          </label>
          <input
            id={fieldId("reference_no")}
            name="reference_no"
            defaultValue={val("reference_no", engagement?.reference_no ?? "")}
            className="field"
            placeholder="INV-2026-..."
          />
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <div>
          <label htmlFor={fieldId("engaged_on")} className="label">
            Service / bill date
          </label>
          <input
            id={fieldId("engaged_on")}
            type="date"
            name="engaged_on"
            defaultValue={val("engaged_on", engagement?.engaged_on ?? todayStr)}
            className="field"
            required
          />
        </div>
        <div>
          <label htmlFor={fieldId("due_on")} className="label">
            Payment due date
          </label>
          <input
            id={fieldId("due_on")}
            type="date"
            name="due_on"
            defaultValue={val("due_on", engagement?.due_on ?? "")}
            className="field"
          />
        </div>
        <div>
          <label htmlFor={fieldId("handled_by")} className="label">
            Staff lead
          </label>
          <input
            id={fieldId("handled_by")}
            name="handled_by"
            list={`${uid}-staff-leads`}
            defaultValue={val("handled_by", engagement?.handled_by ?? "")}
            className="field"
            placeholder="Staff member"
          />
          <datalist id={`${uid}-staff-leads`}>
            {staffNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={fieldId("next_vendor_due_date")} className="label mb-0">
            Advance vendor next due date (optional)
          </label>
          {suggestedNextDue && selectedVendor?.billing_cycle && (
            <button
              type="button"
              onClick={() => setNextVendorDueInput(suggestedNextDue)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-iica-700 hover:underline"
            >
              <CalendarPlus size={12} />
              Suggest +1 {BILLING_CYCLE_LABELS[selectedVendor.billing_cycle]?.toLowerCase() ?? "cycle"} ({suggestedNextDue})
            </button>
          )}
        </div>
        <input
          id={fieldId("next_vendor_due_date")}
          type="date"
          name="next_vendor_due_date"
          value={nextVendorDueInput}
          onChange={(e) => setNextVendorDueInput(e.target.value)}
          className="field mt-1"
        />
        {selectedVendor?.next_due_date && (
          <p className="mt-1 text-[11px] text-ink/55">
            Current scheduled due date: {selectedVendor.next_due_date}
            {selectedVendor.billing_cycle
              ? ` (${BILLING_CYCLE_LABELS[selectedVendor.billing_cycle] ?? selectedVendor.billing_cycle})`
              : ""}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={fieldId("notes")} className="label">
          Notes
        </label>
        <textarea
          id={fieldId("notes")}
          name="notes"
          defaultValue={val("notes", engagement?.notes ?? "")}
          className="field min-h-16"
          placeholder="Optional details or payment reference"
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {(onCancel || onSaved) && (
          <button
            type="button"
            onClick={onCancel ?? onSaved}
            className="btn btn-ghost w-full sm:w-auto"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary w-full sm:w-auto"
          disabled={pending || selectableVendors.length === 0}
        >
          {pending ? "Saving…" : isEdit ? "Save changes" : "Save record"}
        </button>
      </div>
    </form>
  );
}

export function NewVendorButton({
  canViewReports = false,
}: {
  canViewReports?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New vendor
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add vendor"
        description="Add a supplier, contractor or utility account."
      >
        <VendorFormFields
          canViewReports={canViewReports}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function LogEngagementButton({
  vendors,
  staffNames = [],
  canViewReports = false,
  todayKey,
}: {
  vendors: VendorSelectOption[];
  staffNames?: string[];
  canViewReports?: boolean;
  todayKey?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <ReceiptText size={15} /> Log service / bill
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log service, invoice or utility bill"
        description="Record a quote, invoice, utility payment or maintenance job."
      >
        <EngagementFormFields
          vendors={vendors}
          staffNames={staffNames}
          canViewReports={canViewReports}
          todayKey={todayKey}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function ImportVendorsForm({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<VendorState, FormData>(importVendorsAction, {});
  const inputId = useId();

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor={inputId} className="label">
          Vendor spreadsheet (.xlsx or .csv)
        </label>
        <input
          id={inputId}
          type="file"
          name="vendors_file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="field text-xs"
          required
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}
      {state.ok && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
          <span>{state.message}</span>
        </div>
      )}
      {state.rowErrors && state.rowErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="font-semibold">
            Skipped {state.skippedCount ?? state.rowErrors.length}{" "}
            {(state.skippedCount ?? state.rowErrors.length) === 1 ? "row" : "rows"} with issues:
          </div>
          <ul className="mt-1.5 max-h-36 list-disc space-y-0.5 overflow-y-auto pl-4 text-[11px]">
            {state.rowErrors.map((err, idx) => (
              <li key={`${err.row}-${idx}`}>
                Row {err.row}: {err.reason}
              </li>
            ))}
          </ul>
          {(state.skippedCount ?? 0) > state.rowErrors.length && (
            <p className="mt-1 text-[11px] text-amber-800">
              Showing first {state.rowErrors.length} of {state.skippedCount} skipped rows.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Upload size={14} />
          {pending ? "Importing…" : "Upload & import"}
        </button>
      </div>
    </form>
  );
}

export function ImportVendorsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Upload size={15} /> Import
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Import vendors"
        description="Upload an .xlsx or .csv file to add or update vendors."
      >
        <ImportVendorsForm onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function ExportVendorsButton({
  canViewReports = false,
}: {
  canViewReports?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedDatasets, setSelectedDatasets] = useState<
    ("vendors" | "contracts" | "engagements")[]
  >(["vendors", "contracts", "engagements"]);
  const [includeEstCost, setIncludeEstCost] = useState(canViewReports);
  const [includeCost, setIncludeCost] = useState(canViewReports);
  const [group, setGroup] = useState<string>("ALL");
  const [status, setStatus] = useState<string>("ALL");
  const [format, setFormat] = useState<"xlsx" | "csv" | "json">("xlsx");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const uid = useId();

  const allSelected = selectedDatasets.length === 3;

  const toggleDataset = (id: "vendors" | "contracts" | "engagements") => {
    setSelectedDatasets((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((item) => item !== id) : prev;
      }
      return [...prev, id];
    });
  };

  const href = useMemo(() => {
    const params = new URLSearchParams();
    const ordered = (["vendors", "contracts", "engagements"] as const).filter((id) =>
      selectedDatasets.includes(id),
    );
    params.set("format", format);
    params.set("datasets", ordered.join(","));
    params.set("estCost", canViewReports && includeEstCost ? "1" : "0");
    params.set("cost", canViewReports && includeCost ? "1" : "0");
    if (group !== "ALL") params.set("group", group);
    if (status !== "ALL") params.set("status", status);
    return `/api/export/vendors?${params.toString()}`;
  }, [format, selectedDatasets, canViewReports, includeEstCost, includeCost, group, status]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) {
        const message = (await res.text().catch(() => "")).trim();
        setDownloadError(message || `Export failed (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `tt-delegation-vendors.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setOpen(false);
    } catch {
      setDownloadError("Network error while downloading export.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setDownloadError(null);
          setOpen(true);
        }}
      >
        <Download size={15} /> Export
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Export vendors"
        description={
          canViewReports
            ? "Choose one or more datasets and optional cost columns to download."
            : "Choose one or more datasets to download."
        }
      >
        <div className="space-y-4">
          <div>
            <span className="label">Include datasets (select one or more)</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={allSelected}
                onClick={() => setSelectedDatasets(["vendors", "contracts", "engagements"])}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  allSelected
                    ? "border-iica-700 bg-iica-50 text-iica-800"
                    : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                }`}
              >
                {allSelected && <Check size={12} />}
                All records
              </button>
              {(
                [
                  { id: "vendors", label: "Vendor directory" },
                  { id: "contracts", label: "Contracts & utilities" },
                  { id: "engagements", label: "Service & spend history" },
                ] as const
              ).map((item) => {
                const selected = selectedDatasets.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleDataset(item.id)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                      selected
                        ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                        : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                    }`}
                  >
                    {selected && <Check size={12} />}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-group`} className="label">
                Category group
              </label>
              <select
                id={`${uid}-group`}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="field text-xs"
              >
                <option value="ALL">All categories</option>
                {VENDOR_GROUP_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {VENDOR_GROUPS[k].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-status`} className="label">
                Approval / contract filter
              </label>
              <select
                id={`${uid}-status`}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="field text-xs"
              >
                <option value="ALL">All statuses</option>
                <option value="PREFERRED">Preferred vendors only</option>
                <option value="APPROVED">Approved</option>
                <option value="CONTRACTS">Contracts &amp; utilities</option>
                <option value="RENEWAL_DUE">Renewals due</option>
                <option value="ON_HOLD">On hold</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          {canViewReports && (
            <div>
              <span className="label">Optional cost columns</span>
              <div className="flex flex-wrap gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    includeEstCost
                      ? "border-iica-300 bg-iica-50/70 text-iica-900"
                      : "border-ink/12 bg-white text-ink/65 hover:border-iica-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={includeEstCost}
                    onChange={(e) => setIncludeEstCost(e.target.checked)}
                    className="accent-iica-700"
                  />
                  Include est. cost
                </label>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    includeCost
                      ? "border-iica-300 bg-iica-50/70 text-iica-900"
                      : "border-ink/12 bg-white text-ink/65 hover:border-iica-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={includeCost}
                    onChange={(e) => setIncludeCost(e.target.checked)}
                    className="accent-iica-700"
                  />
                  Include cost / spend
                </label>
              </div>
            </div>
          )}

          <div>
            <span className="label">Format</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  { key: "xlsx", label: "Excel", hint: ".xlsx", icon: FileSpreadsheet },
                  { key: "csv", label: "CSV", hint: ".csv", icon: FileText },
                  { key: "json", label: "JSON", hint: ".json", icon: FileJson },
                ] as const
              ).map(({ key, label, hint, icon: Icon }) => {
                const active = format === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFormat(key)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      active
                        ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                        : "border-ink/12 bg-white text-ink hover:border-iica-300 hover:bg-iica-50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-white" : "text-ink/55"} />
                    <div className="mt-1.5 text-xs font-semibold">{label}</div>
                    <div className={`text-[11px] ${active ? "text-white/80" : "text-ink/60"}`}>
                      {hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {downloadError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
            >
              {downloadError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-ink/8 pt-3.5">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="btn btn-primary"
            >
              <Download size={15} /> {downloading ? "Preparing…" : "Download"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
