import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/auth";
import { authenticateExportRequest, neutralizeFormulaString } from "@/lib/export";
import { getPermissionMatrix } from "@/lib/permissions";
import { canWith } from "@/lib/roles";
import {
  BILLING_CYCLE_LABELS,
  CONTRACT_STATUS_META,
  ENGAGEMENT_KIND_LABELS,
  ENGAGEMENT_STATUS_META,
  VENDOR_GROUP_ORDER,
  VENDOR_STATUS_META,
  trinidadTodayKey,
  vendorGroupForCategory,
} from "@/lib/vendor-groups";
import { listVendorsWithStats } from "@/lib/vendors";

export const maxDuration = 60;

const ALL_DATASETS = ["vendors", "contracts", "engagements"] as const;
type DatasetKey = (typeof ALL_DATASETS)[number];

const ALLOWED_STATUS_FILTERS = [
  "ALL",
  "PREFERRED",
  "APPROVED",
  "ON_HOLD",
  "INACTIVE",
  "CONTRACTS",
  "RENEWAL_DUE",
] as const;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = neutralizeFormulaString(String(value));
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function xlsxValue(value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return neutralizeFormulaString(String(value));
}

function styleSheetHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14477D" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
}

function parseDatasets(params: URLSearchParams): { datasets?: DatasetKey[]; error?: string } {
  const rawList = params.get("datasets");
  if (rawList !== null) {
    const tokens = rawList
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return { error: "Select at least one dataset to export." };
    const invalid = tokens.filter((t) => !(ALL_DATASETS as readonly string[]).includes(t));
    if (invalid.length > 0) return { error: "Unknown dataset requested." };
    return { datasets: Array.from(new Set(tokens as DatasetKey[])) };
  }

  const single = (params.get("dataset") || "vendors").trim().toLowerCase();
  if (single === "all") return { datasets: [...ALL_DATASETS] };
  if ((ALL_DATASETS as readonly string[]).includes(single)) {
    return { datasets: [single as DatasetKey] };
  }
  return { error: "Unknown dataset requested." };
}

type ColumnDef<Row extends Record<string, unknown>> = {
  header: string;
  key: keyof Row & string;
  width: number;
  numeric?: boolean;
  currency?: boolean;
};

export async function GET(req: Request) {
  const auth = await authenticateExportRequest(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const matrix = await getPermissionMatrix();
  if (!canWith(matrix, user.role, "vendors.view")) {
    return new NextResponse("Forbidden", { status: 403, headers: SECURITY_HEADERS });
  }

  const canViewReports = canWith(matrix, user.role, "reports.view");
  const params = new URL(req.url).searchParams;

  const rawFormat = (params.get("format") || "xlsx").trim().toLowerCase();
  if (!["xlsx", "csv", "json"].includes(rawFormat)) {
    return new NextResponse("Invalid export format.", { status: 400, headers: SECURITY_HEADERS });
  }
  const format = rawFormat as "xlsx" | "csv" | "json";

  const { datasets: selectedDatasets, error: datasetError } = parseDatasets(params);
  if (datasetError || !selectedDatasets) {
    return new NextResponse(datasetError ?? "Invalid datasets parameter.", {
      status: 400,
      headers: SECURITY_HEADERS,
    });
  }

  const groupParam = (params.get("group") || "ALL").trim().toUpperCase();
  if (groupParam !== "ALL" && !(VENDOR_GROUP_ORDER as readonly string[]).includes(groupParam)) {
    return new NextResponse("Invalid category group filter.", {
      status: 400,
      headers: SECURITY_HEADERS,
    });
  }

  const statusParam = (params.get("status") || "ALL").trim().toUpperCase();
  if (!(ALLOWED_STATUS_FILTERS as readonly string[]).includes(statusParam)) {
    return new NextResponse("Invalid status filter.", { status: 400, headers: SECURITY_HEADERS });
  }

  const hasVendors = selectedDatasets.includes("vendors");
  const hasContracts = selectedDatasets.includes("contracts");
  const hasEngagements = selectedDatasets.includes("engagements");

  const includeEstCost = canViewReports && params.get("estCost") !== "0";
  const includeCost = canViewReports && params.get("cost") !== "0";

  const { vendors, engagements } = await listVendorsWithStats();

  const filteredVendors = vendors.filter((v) => {
    if (groupParam !== "ALL" && vendorGroupForCategory(v.category) !== groupParam) return false;
    if (statusParam === "PREFERRED" && v.status !== "PREFERRED") return false;
    if (statusParam === "APPROVED" && v.status !== "APPROVED") return false;
    if (statusParam === "ON_HOLD" && v.status !== "ON_HOLD") return false;
    if (statusParam === "INACTIVE" && v.status !== "INACTIVE") return false;
    if (statusParam === "CONTRACTS" && v.contract_status === "NONE" && !v.next_due_date) {
      return false;
    }
    if (statusParam === "RENEWAL_DUE" && v.contract_status !== "RENEWAL_DUE") return false;
    return true;
  });

  const allowedVendorIds = new Set(filteredVendors.map((v) => v.id));
  const contractVendors = filteredVendors.filter(
    (v) => v.contract_status !== "NONE" || Boolean(v.next_due_date),
  );
  const filteredEngagements = engagements.filter((e) => allowedVendorIds.has(e.vendor_id));

  const vendorExportRows = filteredVendors.map((v) => ({
    name: v.name,
    category: v.category,
    service: v.service ?? "",
    status: VENDOR_STATUS_META[v.status]?.label ?? v.status,
    rating: v.rating ?? null,
    priceTier: v.price_tier ?? "",
    turnaround: v.turnaround ?? "",
    contactPerson: v.contact_person ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    website: v.website ?? "",
    taxId: v.tax_id ?? "",
    address: v.address ?? "",
    paymentTerms: v.payment_terms ?? "",
    contractStatus: CONTRACT_STATUS_META[v.contract_status]?.label ?? v.contract_status,
    billingCycle: v.billing_cycle ? BILLING_CYCLE_LABELS[v.billing_cycle] ?? v.billing_cycle : "",
    nextDueDate: v.next_due_date ?? "",
    ...(includeEstCost ? { estimatedCostTtd: v.estimated_cost ?? null } : {}),
    ...(includeCost
      ? {
          standardCostTtd: v.standard_cost ?? null,
          paidSpendTtd: v.total_spend_ttd,
          pendingSpendTtd: v.pending_spend_ttd,
          quotedTtd: v.quoted_ttd,
        }
      : {}),
    recordsLogged: v.engagement_count,
    lastEngagedOn: v.last_engaged_on ?? "",
    notes: v.notes ?? "",
  }));

  const contractExportRows = contractVendors.map((v) => ({
    name: v.name,
    category: v.category,
    service: v.service ?? "",
    contractStatus: CONTRACT_STATUS_META[v.contract_status]?.label ?? v.contract_status,
    billingCycle: v.billing_cycle ? BILLING_CYCLE_LABELS[v.billing_cycle] ?? v.billing_cycle : "",
    nextDueDate: v.next_due_date ?? "",
    ...(includeEstCost ? { estimatedCostTtd: v.estimated_cost ?? null } : {}),
    ...(includeCost
      ? {
          standardCostTtd: v.standard_cost ?? null,
          paidSpendTtd: v.total_spend_ttd,
          pendingSpendTtd: v.pending_spend_ttd,
          quotedTtd: v.quoted_ttd,
        }
      : {}),
    contactPerson: v.contact_person ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    notes: v.notes ?? "",
  }));

  const engagementExportRows = filteredEngagements.map((e) => ({
    date: e.engaged_on,
    vendor: e.vendor_name,
    category: e.vendor_category,
    type: ENGAGEMENT_KIND_LABELS[e.kind] ?? e.kind,
    description: e.title,
    referenceNo: e.reference_no ?? "",
    ...(includeEstCost ? { estimatedCostTtd: e.estimated_cost_ttd ?? null } : {}),
    ...(includeCost ? { amountTtd: e.amount_ttd ?? null } : {}),
    status: ENGAGEMENT_STATUS_META[e.status]?.label ?? e.status,
    dueDate: e.due_on ?? "",
    staffLead: e.handled_by ?? "",
    notes: e.notes ?? "",
  }));

  type VendorExportRow = (typeof vendorExportRows)[number];
  type ContractExportRow = (typeof contractExportRows)[number];
  type EngagementExportRow = (typeof engagementExportRows)[number];

  const vendorColumns: ColumnDef<VendorExportRow>[] = [
    { header: "Vendor", key: "name", width: 28 },
    { header: "Category", key: "category", width: 18 },
    { header: "Service", key: "service", width: 28 },
    { header: "Status", key: "status", width: 14 },
    { header: "Rating", key: "rating", width: 10, numeric: true },
    { header: "Price tier", key: "priceTier", width: 14 },
    { header: "Turnaround", key: "turnaround", width: 18 },
    { header: "Contact person", key: "contactPerson", width: 22 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Email", key: "email", width: 28 },
    { header: "Website", key: "website", width: 28 },
    { header: "Tax ID", key: "taxId", width: 16 },
    { header: "Address", key: "address", width: 28 },
    { header: "Payment terms", key: "paymentTerms", width: 16 },
    { header: "Contract / schedule", key: "contractStatus", width: 18 },
    { header: "Billing cycle", key: "billingCycle", width: 14 },
    { header: "Next due date", key: "nextDueDate", width: 14 },
    ...(includeEstCost
      ? [
          {
            header: "Est. cost (TTD)",
            key: "estimatedCostTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    ...(includeCost
      ? [
          {
            header: "Standard cost (TTD)",
            key: "standardCostTtd" as const,
            width: 20,
            numeric: true,
            currency: true,
          },
          {
            header: "Paid spend (TTD)",
            key: "paidSpendTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
          {
            header: "Pending spend (TTD)",
            key: "pendingSpendTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
          {
            header: "Quoted (TTD)",
            key: "quotedTtd" as const,
            width: 16,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    { header: "Records logged", key: "recordsLogged", width: 14, numeric: true },
    { header: "Last engaged", key: "lastEngagedOn", width: 14 },
    { header: "Notes", key: "notes", width: 32 },
  ];

  const contractColumns: ColumnDef<ContractExportRow>[] = [
    { header: "Vendor", key: "name", width: 28 },
    { header: "Category", key: "category", width: 18 },
    { header: "Service", key: "service", width: 28 },
    { header: "Schedule status", key: "contractStatus", width: 18 },
    { header: "Billing cycle", key: "billingCycle", width: 14 },
    { header: "Next due date", key: "nextDueDate", width: 14 },
    ...(includeEstCost
      ? [
          {
            header: "Est. cost (TTD)",
            key: "estimatedCostTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    ...(includeCost
      ? [
          {
            header: "Standard cost (TTD)",
            key: "standardCostTtd" as const,
            width: 20,
            numeric: true,
            currency: true,
          },
          {
            header: "Paid spend (TTD)",
            key: "paidSpendTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
          {
            header: "Pending spend (TTD)",
            key: "pendingSpendTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
          {
            header: "Quoted (TTD)",
            key: "quotedTtd" as const,
            width: 16,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    { header: "Contact person", key: "contactPerson", width: 22 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Email", key: "email", width: 28 },
    { header: "Notes", key: "notes", width: 32 },
  ];

  const engagementColumns: ColumnDef<EngagementExportRow>[] = [
    { header: "Date", key: "date", width: 14 },
    { header: "Vendor", key: "vendor", width: 28 },
    { header: "Category", key: "category", width: 18 },
    { header: "Type", key: "type", width: 18 },
    { header: "Description", key: "description", width: 38 },
    { header: "Reference #", key: "referenceNo", width: 16 },
    ...(includeEstCost
      ? [
          {
            header: "Est. cost (TTD)",
            key: "estimatedCostTtd" as const,
            width: 18,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    ...(includeCost
      ? [
          {
            header: "Cost / amount (TTD)",
            key: "amountTtd" as const,
            width: 20,
            numeric: true,
            currency: true,
          },
        ]
      : []),
    { header: "Status", key: "status", width: 16 },
    { header: "Due date", key: "dueDate", width: 14 },
    { header: "Staff lead", key: "staffLead", width: 20 },
    { header: "Notes", key: "notes", width: 32 },
  ];

  const slugPart = selectedDatasets.length === ALL_DATASETS.length ? "all" : selectedDatasets.join("-");
  const stamp = trinidadTodayKey();
  const fileSlug = `tt-delegation-vendors-${slugPart}-${stamp}`;

  try {
    const exportedRows =
      (hasVendors ? vendorExportRows.length : 0) +
      (hasContracts ? contractExportRows.length : 0) +
      (hasEngagements ? engagementExportRows.length : 0);
    await recordAudit({
      user,
      action: "EXPORT",
      entity: "vendor",
      details: `Format: ${format.toUpperCase()} · Datasets: ${selectedDatasets.join(", ")} · Rows: ${exportedRows}`,
    });
  } catch (err) {
    console.error("Failed to record vendor export audit entry:", err);
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "IICA-TT Internal System";
    wb.created = new Date();

    const addDatasetSheet = <Row extends Record<string, unknown>>(
      title: string,
      columns: ColumnDef<Row>[],
      rows: Row[],
    ) => {
      const ws = wb.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
      for (const row of rows) {
        const sanitized: Record<string, string | number | null> = {};
        for (const col of columns) {
          sanitized[col.key] = xlsxValue(row[col.key]);
        }
        ws.addRow(sanitized);
      }
      columns.forEach((col, idx) => {
        if (col.currency) ws.getColumn(idx + 1).numFmt = "#,##0.00";
      });
      if (columns.length > 0) {
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: columns.length },
        };
      }
      styleSheetHeader(ws);
    };

    if (hasVendors) addDatasetSheet("Vendors", vendorColumns, vendorExportRows);
    if (hasContracts) addDatasetSheet("Contracts & Utilities", contractColumns, contractExportRows);
    if (hasEngagements) {
      addDatasetSheet("Service & Spend History", engagementColumns, engagementExportRows);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileSlug}.xlsx"`,
      },
    });
  }

  if (format === "json") {
    let payload: unknown;
    if (selectedDatasets.length === 1) {
      payload = hasVendors
        ? vendorExportRows
        : hasContracts
          ? contractExportRows
          : engagementExportRows;
    } else {
      payload = {
        ...(hasVendors ? { vendors: vendorExportRows } : {}),
        ...(hasContracts ? { contracts: contractExportRows } : {}),
        ...(hasEngagements ? { engagements: engagementExportRows } : {}),
      };
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileSlug}.json"`,
      },
    });
  }

  const buildCsvSection = <Row extends Record<string, unknown>>(
    title: string,
    columns: ColumnDef<Row>[],
    rows: Row[],
  ) => {
    const header = columns.map((c) => c.header);
    const dataRows = rows.map((row) => columns.map((c) => row[c.key]));
    return {
      title,
      lines: [header, ...dataRows].map((r) => r.map(csvCell).join(",")),
    };
  };

  const csvSections: { title: string; lines: string[] }[] = [];
  if (hasVendors) {
    csvSections.push(buildCsvSection("Vendor directory", vendorColumns, vendorExportRows));
  }
  if (hasContracts) {
    csvSections.push(buildCsvSection("Contracts & utilities", contractColumns, contractExportRows));
  }
  if (hasEngagements) {
    csvSections.push(
      buildCsvSection("Service & spend history", engagementColumns, engagementExportRows),
    );
  }

  const csvBody =
    csvSections.length === 1
      ? csvSections[0].lines.join("\r\n")
      : csvSections
          .map((sec) => [csvCell(sec.title), ...sec.lines].join("\r\n"))
          .join("\r\n\r\n");

  return new NextResponse(`\uFEFF${csvBody}`, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileSlug}.csv"`,
    },
  });
}
