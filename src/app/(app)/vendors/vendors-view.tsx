"use client";

import { useSyncedState } from "@/lib/use-synced-state";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Hash,
  LayoutGrid,
  ListChecks,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  Search,
  Star,
  Table2,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { FilterSelect } from "@/components/filter-select";
import { SavedViews } from "@/components/saved-views";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/ui";
import {
  BILLING_CYCLE_LABELS,
  CONTRACT_STATUS_META,
  ENGAGEMENT_KIND_LABELS,
  ENGAGEMENT_STATUS_META,
  VENDOR_GROUPS,
  VENDOR_GROUP_ORDER,
  VENDOR_STATUS_META,
  formatTtd,
  parseSafeHttpUrl,
  vendorGroupForCategory,
  type VendorGroupKey,
} from "@/lib/vendor-groups";
import type { VendorEngagementItem, VendorItem } from "@/lib/vendors";
import {
  deleteVendorAction,
  deleteVendorEngagementAction,
  type VendorState,
} from "./actions";
import {
  EngagementFormFields,
  VendorFormFields,
  type VendorSelectOption,
} from "./vendor-form";

type ViewMode = "cards" | "table" | "contracts" | "history";

const VALID_VIEW_MODES: readonly ViewMode[] = ["cards", "table", "contracts", "history"];
const VALID_STATUS_FILTERS = [
  "ALL",
  "PREFERRED",
  "APPROVED",
  "ON_HOLD",
  "INACTIVE",
  "CONTRACTS",
  "RENEWAL_DUE",
] as const;

function formatShortDate(dayStr: string | null | undefined): string {
  if (!dayStr || !/^\d{4}-\d{2}-\d{2}/.test(dayStr)) return "-";
  return new Date(`${dayStr.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysUntil(dayStr: string | null | undefined, todayKey: string | null): number | null {
  if (!todayKey || !dayStr || !/^\d{4}-\d{2}-\d{2}/.test(dayStr)) return null;
  const target = Date.parse(`${dayStr.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

function hasSchedule(v: VendorItem): boolean {
  return v.contract_status !== "NONE" || Boolean(v.next_due_date);
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-700 tabular-nums"
      title={`Internal rating: ${rating} out of 5`}
    >
      <Star size={11} className="fill-amber-400 text-amber-500" aria-hidden="true" />
      {rating}.0
    </span>
  );
}

const PRICE_TIER_LABELS: Record<string, string> = {
  BUDGET: "Budget",
  STANDARD: "Standard",
  PREMIUM: "Premium",
};

function DeleteVendorConfirmForm({
  vendor,
  onDeleted,
  onCancel,
}: {
  vendor: VendorItem;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<VendorState, FormData>(deleteVendorAction, {});
  const onDeletedRef = useRef(onDeleted);
  useEffect(() => {
    onDeletedRef.current = onDeleted;
  }, [onDeleted]);

  useEffect(() => {
    if (state.ok) onDeletedRef.current();
  }, [state.ok]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={vendor.id} />
      <p className="text-sm leading-relaxed text-ink/75">
        Are you sure you want to permanently delete{" "}
        <span className="font-semibold text-ink">{vendor.name}</span>?
      </p>
      {vendor.engagement_count > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900">
          This vendor has {vendor.engagement_count} logged service/spend{" "}
          {vendor.engagement_count === 1 ? "record" : "records"} that will also be permanently
          removed.
        </div>
      )}
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="btn btn-ghost w-full sm:w-auto">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn btn-danger w-full sm:w-auto">
          <Trash2 size={14} />
          {pending ? "Deleting…" : "Delete vendor"}
        </button>
      </div>
    </form>
  );
}

function DeleteEngagementConfirmForm({
  engagement,
  onDeleted,
  onCancel,
}: {
  engagement: VendorEngagementItem;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<VendorState, FormData>(
    deleteVendorEngagementAction,
    {},
  );
  const onDeletedRef = useRef(onDeleted);
  useEffect(() => {
    onDeletedRef.current = onDeleted;
  }, [onDeleted]);

  useEffect(() => {
    if (state.ok) onDeletedRef.current();
  }, [state.ok]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={engagement.id} />
      <p className="text-sm leading-relaxed text-ink/75">
        Permanently delete <span className="font-semibold text-ink">{engagement.title}</span>{" "}
        for <span className="font-semibold text-ink">{engagement.vendor_name}</span>?
      </p>
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
        >
          {state.error}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="btn btn-ghost w-full sm:w-auto">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn btn-danger w-full sm:w-auto">
          <Trash2 size={14} />
          {pending ? "Deleting…" : "Delete record"}
        </button>
      </div>
    </form>
  );
}

export function VendorsView({
  vendors,
  engagements,
  canManage,
  canViewReports = false,
  staffNames = [],
  todayKey,
}: {
  vendors: VendorItem[];
  engagements: VendorEngagementItem[];
  canManage: boolean;
  canViewReports?: boolean;
  staffNames?: string[];
  /** Today in Trinidad, worked out on the server so due-date labels render on the first paint. */
  todayKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawView = (searchParams.get("view") ?? "cards").toLowerCase();
  const viewMode: ViewMode = (VALID_VIEW_MODES as readonly string[]).includes(rawView)
    ? (rawView as ViewMode)
    : "cards";

  const rawGroup = (searchParams.get("group") ?? "ALL").toUpperCase();
  const groupFilter: "ALL" | VendorGroupKey =
    rawGroup !== "ALL" && (VENDOR_GROUP_ORDER as readonly string[]).includes(rawGroup)
      ? (rawGroup as VendorGroupKey)
      : "ALL";

  const rawStatus = (searchParams.get("status") ?? "ALL").toUpperCase();
  const statusFilter = (VALID_STATUS_FILTERS as readonly string[]).includes(rawStatus)
    ? rawStatus
    : "ALL";

  const urlQ = searchParams.get("q") ?? "";
  // Follows the URL on Back/Forward while staying editable in between.
  const [searchInput, setSearchInput] = useSyncedState(urlQ);
  const parsedPage = Math.trunc(Number(searchParams.get("page")));
  const rawPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const query = next.toString();
      router.replace(query ? `/vendors?${query}` : "/vendors", { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (searchInput === urlQ) return;
    const timer = setTimeout(() => {
      updateUrl({ q: searchInput.trim() || null, page: null });
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput, urlQ, updateUrl]);

  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [editingVendor, setEditingVendor] = useState<VendorItem | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<VendorItem | null>(null);
  const [logForVendorId, setLogForVendorId] = useState<number | null>(null);
  const [editingEngagement, setEditingEngagement] = useState<VendorEngagementItem | null>(null);
  const [deletingEngagement, setDeletingEngagement] = useState<VendorEngagementItem | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<number, boolean>>({});

  const queryTerm = searchInput.trim().toLowerCase();

  const matchesVendorSearch = useCallback(
    (v: VendorItem) => {
      if (!queryTerm) return true;
      const hay = `${v.name} ${v.category} ${v.service ?? ""} ${v.contact_person ?? ""} ${
        v.email ?? ""
      } ${v.phone ?? ""} ${v.address ?? ""} ${v.website ?? ""} ${v.tax_id ?? ""} ${
        v.notes ?? ""
      }`.toLowerCase();
      return hay.includes(queryTerm);
    },
    [queryTerm],
  );

  const matchesVendorStatus = useCallback(
    (v: VendorItem) => {
      if (statusFilter === "PREFERRED") return v.status === "PREFERRED";
      if (statusFilter === "APPROVED") return v.status === "APPROVED";
      if (statusFilter === "ON_HOLD") return v.status === "ON_HOLD";
      if (statusFilter === "INACTIVE") return v.status === "INACTIVE";
      if (statusFilter === "CONTRACTS") return hasSchedule(v);
      if (statusFilter === "RENEWAL_DUE") return v.contract_status === "RENEWAL_DUE";
      return true;
    },
    [statusFilter],
  );

  const matchesEngagementSearch = useCallback(
    (e: VendorEngagementItem) => {
      if (!queryTerm) return true;
      const kindLabel = ENGAGEMENT_KIND_LABELS[e.kind] ?? e.kind;
      const hay = `${e.vendor_name} ${e.vendor_category} ${e.kind} ${kindLabel} ${e.title} ${
        e.reference_no ?? ""
      } ${e.handled_by ?? ""} ${e.notes ?? ""}`.toLowerCase();
      return hay.includes(queryTerm);
    },
    [queryTerm],
  );

  // Pre-group datasets for active tab so group pill counts always reflect what the user sees
  const directoryPreGroup = useMemo(
    () => vendors.filter((v) => matchesVendorStatus(v) && matchesVendorSearch(v)),
    [vendors, matchesVendorStatus, matchesVendorSearch],
  );

  const contractsPreGroup = useMemo(
    () =>
      vendors
        .filter((v) => hasSchedule(v) && matchesVendorSearch(v))
        .sort((a, b) => {
          const da = a.next_due_date ?? "9999-12-31";
          const db = b.next_due_date ?? "9999-12-31";
          if (da !== db) return da < db ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [vendors, matchesVendorSearch],
  );

  const historyPreGroup = useMemo(
    () => engagements.filter((e) => matchesEngagementSearch(e)),
    [engagements, matchesEngagementSearch],
  );

  const countsByGroup = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0 };
    for (const k of VENDOR_GROUP_ORDER) counts[k] = 0;

    if (viewMode === "contracts") {
      counts.ALL = contractsPreGroup.length;
      for (const v of contractsPreGroup) {
        const gk = vendorGroupForCategory(v.category);
        counts[gk] = (counts[gk] ?? 0) + 1;
      }
      return counts;
    }

    if (viewMode === "history") {
      counts.ALL = historyPreGroup.length;
      for (const e of historyPreGroup) {
        const gk = vendorGroupForCategory(e.vendor_category);
        counts[gk] = (counts[gk] ?? 0) + 1;
      }
      return counts;
    }

    counts.ALL = directoryPreGroup.length;
    for (const v of directoryPreGroup) {
      const gk = vendorGroupForCategory(v.category);
      counts[gk] = (counts[gk] ?? 0) + 1;
    }
    return counts;
  }, [viewMode, directoryPreGroup, contractsPreGroup, historyPreGroup]);

  const filteredVendors = useMemo(
    () =>
      groupFilter === "ALL"
        ? directoryPreGroup
        : directoryPreGroup.filter((v) => vendorGroupForCategory(v.category) === groupFilter),
    [directoryPreGroup, groupFilter],
  );

  const contractVendors = useMemo(
    () =>
      groupFilter === "ALL"
        ? contractsPreGroup
        : contractsPreGroup.filter((v) => vendorGroupForCategory(v.category) === groupFilter),
    [contractsPreGroup, groupFilter],
  );

  const filteredEngagements = useMemo(
    () =>
      groupFilter === "ALL"
        ? historyPreGroup
        : historyPreGroup.filter(
            (e) => vendorGroupForCategory(e.vendor_category) === groupFilter,
          ),
    [historyPreGroup, groupFilter],
  );

  const selectedVendor = useMemo(
    () =>
      selectedVendorId !== null
        ? vendors.find((v) => v.id === selectedVendorId) ?? null
        : null,
    [vendors, selectedVendorId],
  );

  const selectedVendorEngagements = useMemo(
    () =>
      selectedVendor
        ? engagements.filter((e) => e.vendor_id === selectedVendor.id)
        : [],
    [engagements, selectedVendor],
  );

  const pageSize = viewMode === "cards" ? 18 : 20;
  const activeDatasetCount =
    viewMode === "contracts"
      ? contractVendors.length
      : viewMode === "history"
        ? filteredEngagements.length
        : filteredVendors.length;
  const totalPages = Math.max(1, Math.ceil(activeDatasetCount / pageSize));
  const safePage = Math.min(rawPage, totalPages);

  const visibleVendors = filteredVendors.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const visibleContracts = contractVendors.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const visibleEngagements = filteredEngagements.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const vendorOptions: VendorSelectOption[] = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
        status: v.status,
        billing_cycle: v.billing_cycle,
        next_due_date: v.next_due_date,
      })),
    [vendors],
  );

  const showStatusFilter = viewMode === "cards" || viewMode === "table";
  const hasActiveFilters =
    groupFilter !== "ALL" ||
    (showStatusFilter && statusFilter !== "ALL") ||
    Boolean(searchInput.trim());

  const clearAllFilters = () => {
    setSearchInput("");
    updateUrl({ group: null, status: null, q: null, page: null });
  };

  const contentTransitionKey = `${viewMode}-${groupFilter}-${showStatusFilter ? statusFilter : "all"}-${safePage}`;

  const activeHeadingTitle =
    viewMode === "contracts"
      ? "Contracts & Utilities"
      : viewMode === "history"
        ? "Service & Spend History"
        : groupFilter === "ALL"
          ? "All Vendors"
          : VENDOR_GROUPS[groupFilter].label;

  const paginationParams = {
    view: viewMode === "cards" ? undefined : viewMode,
    group: groupFilter === "ALL" ? undefined : groupFilter,
    status: showStatusFilter && statusFilter !== "ALL" ? statusFilter : undefined,
    q: urlQ || undefined,
  };

  const safeWebsiteUrl = selectedVendor
    ? parseSafeHttpUrl(selectedVendor.website).url
    : null;

  return (
    <div className="space-y-4">
      {/* 1. Category Group Filter Pills & Inline Search/Status Filters */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <FilterSelect
          value={groupFilter}
          onChange={(v) => updateUrl({ group: v === "ALL" ? null : v, page: null })}
          className="w-full sm:w-auto sm:min-w-[12rem]"
          ariaLabel="Filter vendors by category"
          options={[
            { value: "ALL", label: "All categories", count: countsByGroup.ALL ?? 0 },
            ...VENDOR_GROUP_ORDER.map((k) => ({ value: k, label: VENDOR_GROUPS[k].shortLabel, count: countsByGroup[k] ?? 0 })),
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:w-60 sm:flex-none">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/55"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                viewMode === "history"
                  ? "Search vendor, invoice, staff…"
                  : "Search vendors, services…"
              }
              aria-label="Search vendors"
              className="field py-1.5 pr-7 pl-8 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput("");
                  updateUrl({ q: null, page: null });
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/55 hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {showStatusFilter && (
            <FilterSelect
              value={statusFilter}
              onChange={(v) => updateUrl({ status: v === "ALL" ? null : v, page: null })}
              className="min-w-[10rem]"
              ariaLabel="Filter by approval or contract status"
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "PREFERRED", label: "Preferred only" },
                { value: "APPROVED", label: "Approved" },
                { value: "CONTRACTS", label: "Contracts & utilities" },
                { value: "RENEWAL_DUE", label: "Renewal due" },
                { value: "ON_HOLD", label: "On hold" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
          )}

          <SavedViews page="vendors" />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* 2. Full-Width Workspace Panel */}
      <div className="panel relative">
        {/* Header with active context & 4-mode View Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">{activeHeadingTitle}</h2>

          <div
            role="group"
            aria-label="Vendors display mode"
            className="flex flex-wrap items-center gap-1"
          >
            {(
              [
                { id: "cards", label: "Cards", icon: <LayoutGrid size={13} aria-hidden="true" /> },
                { id: "table", label: "Table", icon: <Table2 size={13} aria-hidden="true" /> },
                { id: "contracts", label: "Contracts", icon: <CalendarClock size={13} aria-hidden="true" /> },
                { id: "history", label: "History", icon: <ListChecks size={13} aria-hidden="true" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={viewMode === tab.id}
                onClick={() =>
                  updateUrl({
                    view: tab.id === "cards" ? null : tab.id,
                    page: null,
                  })
                }
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

        {/* Body Content */}
        {viewMode === "cards" && (
          <div key={contentTransitionKey} className="animate-fade p-4 sm:p-5">
            {visibleVendors.length === 0 ? (
              <EmptyState
                icon={<Building2 size={20} />}
                title="No vendors match those filters"
                description="Try clearing your search or status filter to view the directory."
                action={
                  hasActiveFilters ? (
                    <button type="button" onClick={clearAllFilters} className="btn btn-ghost text-xs">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {visibleVendors.map((v) => {
                  const gk = vendorGroupForCategory(v.category);
                  const gMeta = VENDOR_GROUPS[gk];
                  const statusMeta = VENDOR_STATUS_META[v.status] ?? VENDOR_STATUS_META.APPROVED;
                  const contractMeta = CONTRACT_STATUS_META[v.contract_status];
                  const isSelected = selectedVendor?.id === v.id;

                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVendorId(v.id)}
                      className={`flex w-full flex-col justify-between rounded-2xl border p-3.5 text-left transition ${
                        isSelected
                          ? "border-iica-700 bg-iica-50/40 ring-2 ring-iica-600/20"
                          : "border-ink/10 bg-white hover:border-iica-300 hover:bg-iica-50/20"
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${gMeta.badgeClass}`}
                            >
                              {v.category}
                            </span>
                            {v.status !== "APPROVED" && (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusMeta.chipClass}`}
                              >
                                {statusMeta.label}
                              </span>
                            )}
                            {v.contract_status === "RENEWAL_DUE" && (
                              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                                Renewal due
                              </span>
                            )}
                          </div>
                          <StarRating rating={v.rating} />
                        </div>

                        <div className="mt-2 text-sm font-semibold text-ink">{v.name}</div>
                        {v.service && (
                          <div className="mt-0.5 line-clamp-1 text-xs text-ink/60">
                            {v.service}
                          </div>
                        )}

                        <div className="mt-2.5 space-y-1 text-[11px] text-ink/60">
                          {v.contact_person && (
                            <div className="flex items-center gap-1.5 truncate">
                              <User size={11} className="shrink-0 text-ink/45" aria-hidden="true" />
                              <span className="truncate">{v.contact_person}</span>
                            </div>
                          )}
                          {v.phone && (
                            <div className="flex items-center gap-1.5 truncate">
                              <Phone size={11} className="shrink-0 text-ink/45" aria-hidden="true" />
                              <span className="truncate">{v.phone}</span>
                            </div>
                          )}
                          {v.email && (
                            <div className="flex items-center gap-1.5 truncate">
                              <Mail size={11} className="shrink-0 text-ink/45" aria-hidden="true" />
                              <span className="truncate">{v.email}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-2.5 text-[11px] text-ink/60">
                        <span>
                          {hasSchedule(v) && v.next_due_date
                            ? `${contractMeta?.label ?? "Scheduled"} · Due ${formatShortDate(v.next_due_date)}`
                            : v.payment_terms || "Standard terms"}
                        </span>
                        {canViewReports && v.total_spend_ttd > 0 && (
                          <span className="font-semibold text-ink/80 tabular-nums">
                            {formatTtd(v.total_spend_ttd)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === "table" && (
          <div key={contentTransitionKey} className="animate-fade overflow-x-auto">
            {visibleVendors.length === 0 ? (
              <EmptyState
                icon={<Building2 size={20} />}
                title="No vendors match those filters"
                description="Try clearing your search or status filter to view the directory."
                action={
                  hasActiveFilters ? (
                    <button type="button" onClick={clearAllFilters} className="btn btn-ghost text-xs">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Terms / due</th>
                    {canViewReports && <th className="text-right">Paid spend</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleVendors.map((v) => {
                    const gk = vendorGroupForCategory(v.category);
                    const gMeta = VENDOR_GROUPS[gk];
                    const statusMeta = VENDOR_STATUS_META[v.status] ?? VENDOR_STATUS_META.APPROVED;
                    const isSelected = selectedVendor?.id === v.id;
                    return (
                      <tr key={v.id} className={isSelected ? "bg-iica-50/75" : ""}>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedVendorId(v.id)}
                            className="w-full text-left font-semibold text-ink hover:text-iica-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
                          >
                            {v.name}
                          </button>
                          {v.service && (
                            <div className="mt-0.5 max-w-xs truncate text-xs text-ink/60">
                              {v.service}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${gMeta.badgeClass}`}
                            title={v.category}
                          >
                            {v.category}
                          </span>
                        </td>
                        <td className="text-xs text-ink/70">
                          {v.contact_person && (
                            <div className="font-medium text-ink/85">{v.contact_person}</div>
                          )}
                          {v.phone && <div>{v.phone}</div>}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${statusMeta.chipClass}`}
                            >
                              {statusMeta.label}
                            </span>
                            <StarRating rating={v.rating} />
                          </div>
                        </td>
                        <td className="text-xs text-ink/70 whitespace-nowrap">
                          {v.next_due_date ? formatShortDate(v.next_due_date) : v.payment_terms ?? "-"}
                        </td>
                        {canViewReports && (
                          <td className="text-right font-semibold text-ink/85 tabular-nums whitespace-nowrap">
                            {v.total_spend_ttd > 0 ? formatTtd(v.total_spend_ttd) : "-"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {viewMode === "contracts" && (
          <div key={contentTransitionKey} className="animate-fade overflow-x-auto">
            {visibleContracts.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={20} />}
                title="No recurring contracts or utilities found"
                description="Vendors with a contract type or upcoming due date appear here."
                action={
                  hasActiveFilters ? (
                    <button type="button" onClick={clearAllFilters} className="btn btn-ghost text-xs">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <table className="table-shell w-full [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Schedule</th>
                    <th>Next due</th>
                    {canViewReports && <th>Est. cost</th>}
                    {canManage && <th className="text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleContracts.map((v) => {
                    const gk = vendorGroupForCategory(v.category);
                    const gMeta = VENDOR_GROUPS[gk];
                    const cMeta =
                      CONTRACT_STATUS_META[v.contract_status] ?? CONTRACT_STATUS_META.NONE;
                    const diff = daysUntil(v.next_due_date, todayKey);
                    const isSelected = selectedVendor?.id === v.id;

                    return (
                      <tr key={v.id} className={isSelected ? "bg-iica-50/75" : ""}>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedVendorId(v.id)}
                            className="w-full text-left font-semibold text-ink hover:text-iica-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iica-600"
                          >
                            {v.name}
                          </button>
                          {v.service && (
                            <div className="mt-0.5 text-xs text-ink/60">{v.service}</div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${gMeta.badgeClass}`}
                          >
                            {v.category}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${cMeta.chipClass}`}
                            >
                              {cMeta.label}
                            </span>
                            {v.billing_cycle && (
                              <span className="text-xs text-ink/60 whitespace-nowrap">
                                {BILLING_CYCLE_LABELS[v.billing_cycle] ?? v.billing_cycle}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          <div className="font-medium text-ink">
                            {formatShortDate(v.next_due_date)}
                          </div>
                          {diff !== null && (
                            <div
                              className={`text-[11px] font-medium ${
                                diff <= 14 ? "text-rose-700" : "text-ink/60"
                              }`}
                            >
                              {diff === 0
                                ? "Due today"
                                : diff < 0
                                  ? `${Math.abs(diff)}d overdue`
                                  : `In ${diff}d`}
                            </div>
                          )}
                        </td>
                        {canViewReports && (
                          <td className="font-semibold text-ink/85 tabular-nums whitespace-nowrap">
                            {formatTtd(v.estimated_cost)}
                          </td>
                        )}
                        {canManage && (
                          <td className="text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setLogForVendorId(v.id)}
                              className="btn btn-ghost whitespace-nowrap px-2.5 py-1 text-xs"
                            >
                              <ReceiptText size={12} /> Log payment
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {viewMode === "history" && (
          <div key={contentTransitionKey} className="animate-fade space-y-1.5 p-3.5 sm:p-4">
            {visibleEngagements.length === 0 ? (
              <EmptyState
                icon={<ListChecks size={20} />}
                title="No service records or invoices logged yet"
                description="Quotes, purchase orders, utility bills and maintenance jobs appear here."
                action={
                  hasActiveFilters ? (
                    <button type="button" onClick={clearAllFilters} className="btn btn-ghost text-xs">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              visibleEngagements.map((e) => {
                const gk = vendorGroupForCategory(e.vendor_category);
                const gMeta = VENDOR_GROUPS[gk];
                const stMeta =
                  ENGAGEMENT_STATUS_META[e.status] ?? ENGAGEMENT_STATUS_META.PAID;
                const isExpanded = Boolean(expandedHistoryIds[e.id]);

                return (
                  <div
                    key={e.id}
                    className="overflow-hidden rounded-xl border border-ink/10 bg-white transition hover:border-iica-300"
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedHistoryIds((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
                      }
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                    >
                      <span className="w-24 shrink-0 text-xs font-medium text-ink/60 tabular-nums">
                        {formatShortDate(e.engaged_on)}
                      </span>
                      <span
                        className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline-flex ${gMeta.badgeClass}`}
                      >
                        {e.vendor_name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {e.title}
                      </span>
                      {canViewReports && (
                        <span className="shrink-0 text-xs font-semibold text-ink tabular-nums">
                          {e.amount_ttd != null
                            ? formatTtd(e.amount_ttd)
                            : e.estimated_cost_ttd != null
                              ? `Est. ${formatTtd(e.estimated_cost_ttd)}`
                              : "-"}
                        </span>
                      )}
                      <span
                        className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold md:inline-flex ${stMeta.chipClass}`}
                      >
                        {stMeta.label}
                      </span>
                      <ChevronDown
                        size={15}
                        aria-hidden="true"
                        className={`shrink-0 text-ink/55 transition-transform duration-150 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="animate-expand space-y-2 border-t border-ink/8 bg-iica-50/30 px-3.5 py-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-ink">
                            {e.vendor_name} · {ENGAGEMENT_KIND_LABELS[e.kind] ?? e.kind}
                          </div>
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stMeta.chipClass}`}
                          >
                            {stMeta.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-ink/70">
                          {e.reference_no && (
                            <span className="inline-flex items-center gap-1">
                              <FileText size={12} aria-hidden="true" /> Ref: {e.reference_no}
                            </span>
                          )}
                          {e.handled_by && (
                            <span className="inline-flex items-center gap-1">
                              <User size={12} aria-hidden="true" /> {e.handled_by}
                            </span>
                          )}
                          {e.due_on && (
                            <span className="inline-flex items-center gap-1">
                              <Clock size={12} aria-hidden="true" /> Due {formatShortDate(e.due_on)}
                            </span>
                          )}
                          {canViewReports && e.estimated_cost_ttd != null && (
                            <span className="tabular-nums">
                              Est.: {formatTtd(e.estimated_cost_ttd)}
                            </span>
                          )}
                          {canViewReports && e.amount_ttd != null && (
                            <span className="font-semibold text-ink tabular-nums">
                              Amount: {formatTtd(e.amount_ttd)}
                            </span>
                          )}
                        </div>
                        {e.notes && <p className="text-ink/75">{e.notes}</p>}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setSelectedVendorId(e.vendor_id)}
                            className="btn btn-ghost px-2.5 py-1 text-xs"
                          >
                            <Building2 size={12} /> View vendor
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingEngagement(e)}
                                className="btn btn-ghost px-2.5 py-1 text-xs"
                              >
                                <Pencil size={12} /> Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingEngagement(e)}
                                className="btn btn-danger px-2.5 py-1 text-xs"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Shared URL-synced Pagination */}
        <Pagination
          page={safePage}
          perPage={pageSize}
          total={activeDatasetCount}
          basePath="/vendors"
          params={paginationParams}
        />

        {/* Unified Footer: Static Legend Left + Total Count Right */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-3.5 py-3 text-xs text-ink/60 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {VENDOR_GROUP_ORDER.map((k) => {
              const meta = VENDOR_GROUPS[k];
              return (
                <span
                  key={k}
                  style={{
                    backgroundColor: meta.tint,
                    borderColor: meta.border,
                    color: meta.text,
                  }}
                  className="inline-flex cursor-default items-center rounded-lg border px-2.5 py-0.5 text-[11px] font-medium select-none"
                >
                  {meta.shortLabel}
                </span>
              );
            })}
          </div>

          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
            <span>
              {viewMode === "contracts"
                ? "Total contracts:"
                : viewMode === "history"
                  ? "Total records:"
                  : "Total vendors:"}
            </span>
            <span className="font-semibold text-ink tabular-nums">
              {activeDatasetCount}
            </span>
          </div>
        </div>
      </div>

      {/* Selected Vendor Details Modal */}
      <Modal
        open={Boolean(selectedVendor)}
        onClose={() => setSelectedVendorId(null)}
        title={selectedVendor?.name ?? "Vendor details"}
        description={selectedVendor?.service || selectedVendor?.category}
        width="max-w-xl"
      >
        {selectedVendor && (
          <div className="space-y-4">
            {/* Badges & Rating */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    VENDOR_GROUPS[vendorGroupForCategory(selectedVendor.category)].badgeClass
                  }`}
                >
                  {selectedVendor.category}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    (
                      VENDOR_STATUS_META[selectedVendor.status] ??
                      VENDOR_STATUS_META.APPROVED
                    ).chipClass
                  }`}
                >
                  {(
                    VENDOR_STATUS_META[selectedVendor.status] ??
                    VENDOR_STATUS_META.APPROVED
                  ).label}
                </span>
                {selectedVendor.price_tier && (
                  <span className="inline-flex items-center rounded-full border border-ink/12 bg-iica-50/70 px-2 py-0.5 text-[10px] font-semibold text-ink/75">
                    {PRICE_TIER_LABELS[selectedVendor.price_tier] ?? selectedVendor.price_tier}
                  </span>
                )}
              </div>
              <StarRating rating={selectedVendor.rating} />
            </div>

            {/* Contact & Procurement Terms */}
            <div className="space-y-2 rounded-xl border border-ink/8 bg-iica-50/45 p-3.5 text-xs">
              {selectedVendor.contact_person && (
                <div className="flex items-center gap-2">
                  <User size={14} className="shrink-0 text-iica-700" aria-hidden="true" />
                  <span className="font-medium text-ink">{selectedVendor.contact_person}</span>
                </div>
              )}
              {selectedVendor.phone && (
                <div className="flex items-center gap-2">
                  <Phone size={14} className="shrink-0 text-iica-700" aria-hidden="true" />
                  <a
                    href={`tel:${selectedVendor.phone}`}
                    className="font-medium text-iica-800 hover:underline"
                  >
                    {selectedVendor.phone}
                  </a>
                </div>
              )}
              {selectedVendor.email && (
                <div className="flex items-center gap-2">
                  <Mail size={14} className="shrink-0 text-iica-700" aria-hidden="true" />
                  <a
                    href={`mailto:${selectedVendor.email}`}
                    className="truncate font-medium text-iica-800 hover:underline"
                  >
                    {selectedVendor.email}
                  </a>
                </div>
              )}
              {safeWebsiteUrl && (
                <div className="flex items-center gap-2">
                  <Globe size={14} className="shrink-0 text-iica-700" aria-hidden="true" />
                  <a
                    href={safeWebsiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 truncate font-medium text-iica-800 hover:underline"
                  >
                    <span className="truncate">{safeWebsiteUrl}</span>
                    <ExternalLink size={11} className="shrink-0" aria-hidden="true" />
                  </a>
                </div>
              )}
              {selectedVendor.address && (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-iica-700" aria-hidden="true" />
                  <span className="text-ink/80">{selectedVendor.address}</span>
                </div>
              )}
              {selectedVendor.tax_id && (
                <div className="flex items-center gap-2">
                  <Hash size={14} className="shrink-0 text-iica-700" aria-hidden="true" />
                  <span className="text-ink/80">Tax / BIR ID: {selectedVendor.tax_id}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 border-t border-ink/8 pt-2.5 text-[11px]">
                <div>
                  <span className="block text-ink/60">Payment terms</span>
                  <span className="font-semibold text-ink">
                    {selectedVendor.payment_terms || "Standard"}
                  </span>
                </div>
                <div>
                  <span className="block text-ink/60">Turnaround</span>
                  <span className="font-semibold text-ink">
                    {selectedVendor.turnaround || "-"}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Overview (reports.view gated) */}
            {canViewReports &&
              (selectedVendor.estimated_cost != null ||
                selectedVendor.standard_cost != null ||
                selectedVendor.total_spend_ttd > 0 ||
                selectedVendor.pending_spend_ttd > 0 ||
                selectedVendor.quoted_ttd > 0) && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-ink/10 bg-white p-3.5 text-[11px] sm:grid-cols-3">
                  {selectedVendor.estimated_cost != null && (
                    <div>
                      <span className="block text-ink/60">Est. cost</span>
                      <span className="font-semibold text-ink tabular-nums">
                        {formatTtd(selectedVendor.estimated_cost)}
                      </span>
                    </div>
                  )}
                  {selectedVendor.standard_cost != null && (
                    <div>
                      <span className="block text-ink/60">Standard rate</span>
                      <span className="font-semibold text-ink tabular-nums">
                        {formatTtd(selectedVendor.standard_cost)}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="block text-ink/60">Paid spend</span>
                    <span className="font-semibold text-iica-800 tabular-nums">
                      {formatTtd(selectedVendor.total_spend_ttd)}
                    </span>
                  </div>
                  {selectedVendor.pending_spend_ttd > 0 && (
                    <div>
                      <span className="block text-ink/60">Pending / approved</span>
                      <span className="font-semibold text-amber-800 tabular-nums">
                        {formatTtd(selectedVendor.pending_spend_ttd)}
                      </span>
                    </div>
                  )}
                  {selectedVendor.quoted_ttd > 0 && (
                    <div>
                      <span className="block text-ink/60">Open quotes</span>
                      <span className="font-semibold text-ink/80 tabular-nums">
                        {formatTtd(selectedVendor.quoted_ttd)}
                      </span>
                    </div>
                  )}
                </div>
              )}

            {/* Contract / Utility Schedule */}
            {(hasSchedule(selectedVendor) || selectedVendor.billing_cycle) && (
              <div className="rounded-xl border border-ink/10 bg-white p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">Recurring schedule</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      (
                        CONTRACT_STATUS_META[selectedVendor.contract_status] ??
                        CONTRACT_STATUS_META.NONE
                      ).chipClass
                    }`}
                  >
                    {(
                      CONTRACT_STATUS_META[selectedVendor.contract_status] ??
                      CONTRACT_STATUS_META.NONE
                    ).label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                  <div>
                    <span className="block text-ink/60">Cycle</span>
                    <span className="font-medium text-ink">
                      {selectedVendor.billing_cycle
                        ? BILLING_CYCLE_LABELS[selectedVendor.billing_cycle] ??
                          selectedVendor.billing_cycle
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-ink/60">Next due</span>
                    <span className="font-medium text-ink">
                      {formatShortDate(selectedVendor.next_due_date)}
                    </span>
                  </div>
                  {canViewReports && (
                    <div>
                      <span className="block text-ink/60">Est. cost</span>
                      <span className="font-semibold text-ink tabular-nums">
                        {formatTtd(selectedVendor.estimated_cost)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedVendor.notes && (
              <div className="rounded-xl border border-ink/8 bg-white p-3 text-xs leading-relaxed text-ink/75">
                {selectedVendor.notes}
              </div>
            )}

            {/* Service & Purchase History for this Vendor */}
            <div className="border-t border-ink/8 pt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">
                  Service &amp; spend history ({selectedVendorEngagements.length})
                </span>
                {canViewReports && selectedVendor.total_spend_ttd > 0 && (
                  <span className="text-xs font-semibold text-iica-800 tabular-nums">
                    Paid: {formatTtd(selectedVendor.total_spend_ttd)}
                  </span>
                )}
              </div>

              {selectedVendorEngagements.length > 0 ? (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {selectedVendorEngagements.map((eng) => {
                    const stMeta =
                      ENGAGEMENT_STATUS_META[eng.status] ?? ENGAGEMENT_STATUS_META.PAID;
                    return (
                      <div
                        key={eng.id}
                        className="rounded-xl border border-ink/8 bg-white p-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-ink tabular-nums">
                              {formatShortDate(eng.engaged_on)}
                            </span>
                            <span className="rounded-full border border-ink/10 bg-ink/4 px-1.5 py-0.5 text-[10px] font-medium text-ink/70">
                              {ENGAGEMENT_KIND_LABELS[eng.kind] ?? eng.kind}
                            </span>
                          </div>
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${stMeta.chipClass}`}
                          >
                            {stMeta.label}
                          </span>
                        </div>
                        <div className="mt-1 font-medium text-ink">{eng.title}</div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/60">
                          <span>
                            {[
                              eng.reference_no ? `Ref: ${eng.reference_no}` : null,
                              eng.due_on ? `Due ${formatShortDate(eng.due_on)}` : null,
                              eng.handled_by,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {canViewReports && (
                            <span className="font-semibold text-ink tabular-nums">
                              {eng.amount_ttd != null
                                ? formatTtd(eng.amount_ttd)
                                : eng.estimated_cost_ttd != null
                                  ? `Est. ${formatTtd(eng.estimated_cost_ttd)}`
                                  : "-"}
                              {eng.amount_ttd != null && eng.estimated_cost_ttd != null
                                ? ` (Est. ${formatTtd(eng.estimated_cost_ttd)})`
                                : ""}
                            </span>
                          )}
                        </div>
                        {eng.notes && (
                          <p className="mt-1 text-[11px] text-ink/70">{eng.notes}</p>
                        )}
                        {canManage && (
                          <div className="mt-2 flex items-center gap-2 border-t border-ink/6 pt-2">
                            <button
                              type="button"
                              onClick={() => setEditingEngagement(eng)}
                              className="btn btn-ghost px-2 py-1 text-[11px]"
                            >
                              <Pencil size={11} /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingEngagement(eng)}
                              className="btn btn-danger px-2 py-1 text-[11px]"
                            >
                              <Trash2 size={11} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-ink/60">
                  No invoices, quotes or services logged yet.
                </p>
              )}

              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    const vendorId = selectedVendor.id;
                    setSelectedVendorId(null);
                    setLogForVendorId(vendorId);
                  }}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-ink/20 py-2 text-xs font-semibold text-iica-700 transition hover:border-iica-300 hover:bg-iica-50/50"
                >
                  <Plus size={13} /> Log service or invoice
                </button>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between gap-2 border-t border-ink/8 pt-4">
              {canManage ? (
                <div className="flex flex-1 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const targetVendor = selectedVendor;
                      setSelectedVendorId(null);
                      setEditingVendor(targetVendor);
                    }}
                    className="btn btn-ghost flex-1 py-2 text-xs"
                  >
                    <Pencil size={13} /> Edit vendor
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingVendor(selectedVendor)}
                    className="btn btn-danger py-2 text-xs"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setSelectedVendorId(null)}
                className="btn btn-ghost px-4 py-2 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Vendor Modal */}
      <Modal
        open={Boolean(editingVendor)}
        onClose={() => setEditingVendor(null)}
        title="Edit vendor"
        description="Update supplier details, rating and contract schedule."
      >
        {editingVendor && (
          <VendorFormFields
            vendor={editingVendor}
            onSaved={() => setEditingVendor(null)}
            onCancel={() => setEditingVendor(null)}
          />
        )}
      </Modal>

      {/* Confirm Vendor Delete Modal */}
      <Modal
        open={Boolean(deletingVendor)}
        onClose={() => setDeletingVendor(null)}
        title="Delete vendor"
        description="This action cannot be undone."
        width="max-w-md"
      >
        {deletingVendor && (
          <DeleteVendorConfirmForm
            vendor={deletingVendor}
            onDeleted={() => {
              setDeletingVendor(null);
              setSelectedVendorId(null);
            }}
            onCancel={() => setDeletingVendor(null)}
          />
        )}
      </Modal>

      {/* Log Engagement for Specific Vendor Modal */}
      <Modal
        open={Boolean(logForVendorId)}
        onClose={() => setLogForVendorId(null)}
        title="Log service, invoice or utility bill"
        description="Record a quote, invoice, utility payment or maintenance job."
      >
        {logForVendorId && (
          <EngagementFormFields
            vendors={vendorOptions}
            defaultVendorId={logForVendorId}
            staffNames={staffNames}
            onSaved={() => setLogForVendorId(null)}
            onCancel={() => setLogForVendorId(null)}
          />
        )}
      </Modal>

      {/* Edit Engagement Modal */}
      <Modal
        open={Boolean(editingEngagement)}
        onClose={() => setEditingEngagement(null)}
        title="Edit service record"
        description="Update invoice, payment status or notes."
      >
        {editingEngagement && (
          <EngagementFormFields
            vendors={vendorOptions}
            engagement={editingEngagement}
            staffNames={staffNames}
            onSaved={() => setEditingEngagement(null)}
            onCancel={() => setEditingEngagement(null)}
          />
        )}
      </Modal>

      {/* Confirm Engagement Delete Modal */}
      <Modal
        open={Boolean(deletingEngagement)}
        onClose={() => setDeletingEngagement(null)}
        title="Delete service record"
        description="This action cannot be undone."
        width="max-w-md"
      >
        {deletingEngagement && (
          <DeleteEngagementConfirmForm
            engagement={deletingEngagement}
            onDeleted={() => setDeletingEngagement(null)}
            onCancel={() => setDeletingEngagement(null)}
          />
        )}
      </Modal>
    </div>
  );
}
