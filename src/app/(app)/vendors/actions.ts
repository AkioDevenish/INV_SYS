"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { assertPermission, recordAudit } from "@/lib/auth";
import { sql } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseSafeHttpUrl, trinidadTodayKey } from "@/lib/vendor-groups";
import { ensureVendorsSchemaAndSeed } from "@/lib/vendors";

export type VendorState = {
  error?: string;
  ok?: boolean;
  message?: string;
  values?: Record<string, string>;
  attempt?: number;
  rowErrors?: { row: number; reason: string }[];
  skippedCount?: number;
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_PG_INT = 2_147_483_647;
const MAX_NUMERIC_12_2 = 9_999_999_999.99;

const VALID_VENDOR_STATUSES = ["PREFERRED", "APPROVED", "ON_HOLD", "INACTIVE"] as const;
const VALID_PRICE_TIERS = ["BUDGET", "STANDARD", "PREMIUM"] as const;
const VALID_CONTRACT_STATUSES = [
  "NONE",
  "ACTIVE_CONTRACT",
  "RECURRING_UTILITY",
  "RENEWAL_DUE",
] as const;
const VALID_BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ON_DEMAND"] as const;
const VALID_ENGAGEMENT_KINDS = ["QUOTE", "PO", "INVOICE", "UTILITY_BILL", "SERVICE"] as const;
const VALID_ENGAGEMENT_STATUSES = ["QUOTED", "APPROVED", "PENDING_PAYMENT", "PAID"] as const;

const VENDOR_FORM_KEYS = [
  "id",
  "name",
  "category",
  "service",
  "status",
  "rating",
  "price_tier",
  "contact_person",
  "phone",
  "email",
  "website",
  "tax_id",
  "address",
  "payment_terms",
  "turnaround",
  "contract_status",
  "billing_cycle",
  "next_due_date",
  "estimated_cost",
  "standard_cost",
  "notes",
] as const;

const ENGAGEMENT_FORM_KEYS = [
  "id",
  "vendor_id",
  "kind",
  "title",
  "estimated_cost_ttd",
  "amount_ttd",
  "status",
  "reference_no",
  "engaged_on",
  "due_on",
  "handled_by",
  "next_vendor_due_date",
  "notes",
] as const;

function text(fd: FormData, key: string): string {
  const val = fd.get(key);
  return typeof val === "string" ? val.trim() : "";
}

function collectValues(fd: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const val = fd.get(key);
    out[key] = typeof val === "string" ? val : "";
  }
  return out;
}

function parsePositiveIntId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PG_INT ? n : null;
}

function parseRealDate(
  raw: string,
  allowIsoTimestamp = false,
): { ok: true; value: string | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const candidate = allowIsoTimestamp && /^\d{4}-\d{2}-\d{2}[T ]/.test(raw) ? raw.slice(0, 10) : raw;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) return { ok: false };
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return { ok: false };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, value: candidate };
}

function parseMoney(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const cleaned = raw.replace(/^(?:tt\$|\$|ttd\s*)/i, "").replace(/,/g, "").trim();
  if (!cleaned) return { ok: true, value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > MAX_NUMERIC_12_2) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function parseRating(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false };
  return { ok: true, value: n };
}

function normalizeVendorStatus(raw: string): (typeof VALID_VENDOR_STATUSES)[number] | null {
  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return (VALID_VENDOR_STATUSES as readonly string[]).includes(token)
    ? (token as (typeof VALID_VENDOR_STATUSES)[number])
    : null;
}

function normalizePriceTier(raw: string): (typeof VALID_PRICE_TIERS)[number] | null {
  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return (VALID_PRICE_TIERS as readonly string[]).includes(token)
    ? (token as (typeof VALID_PRICE_TIERS)[number])
    : null;
}

function normalizeContractStatus(raw: string): (typeof VALID_CONTRACT_STATUSES)[number] | null {
  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (token === "AS_NEEDED") return "NONE";
  return (VALID_CONTRACT_STATUSES as readonly string[]).includes(token)
    ? (token as (typeof VALID_CONTRACT_STATUSES)[number])
    : null;
}

function normalizeBillingCycle(raw: string): (typeof VALID_BILLING_CYCLES)[number] | null {
  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return (VALID_BILLING_CYCLES as readonly string[]).includes(token)
    ? (token as (typeof VALID_BILLING_CYCLES)[number])
    : null;
}

function mapVendorDbError(error: unknown, fallback: string): string {
  console.error("[vendors/actions]", error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "23505") return "A vendor with that name already exists.";
  if (code === "23503") return "The selected vendor or referenced record does not exist.";
  if (code === "22003") return "One of the numbers entered is out of the allowed range.";
  if (code === "22007" || code === "22008") return "One of the dates entered is not valid.";
  if (code === "23514") return "One of the submitted values failed a database check.";
  if (error instanceof Error && (error.message.includes("not signed in") || error.message.includes("does not allow"))) {
    return error.message;
  }
  return fallback;
}

export async function saveVendorAction(prev: VendorState, fd: FormData): Promise<VendorState> {
  const values = collectValues(fd, VENDOR_FORM_KEYS);
  const fail = (error: string): VendorState => ({
    error,
    values,
    attempt: (prev.attempt ?? 0) + 1,
  });

  try {
    const user = await assertPermission("vendors.manage");
    if (user.mustChangePassword) {
      return fail("Please change your temporary password before making changes.");
    }
    const canViewReports = await can(user.role, "reports.view");
    await ensureVendorsSchemaAndSeed();

    const idRaw = text(fd, "id");
    let id: number | null = null;
    if (idRaw) {
      id = parsePositiveIntId(idRaw);
      if (!id) return fail("Invalid vendor identifier.");
    }

    const name = text(fd, "name");
    if (!name) return fail("Vendor name is required.");
    if (name.length > 200) return fail("Vendor name must be 200 characters or fewer.");

    const category = text(fd, "category") || "Other";
    const service = text(fd, "service") || null;

    const statusRaw = text(fd, "status");
    const status = statusRaw ? normalizeVendorStatus(statusRaw) : "APPROVED";
    if (!status) return fail("Choose a valid approval status.");

    const ratingParsed = parseRating(text(fd, "rating"));
    if (!ratingParsed.ok) return fail("Rating must be a whole number between 1 and 5.");

    const tierRaw = text(fd, "price_tier");
    const priceTier = tierRaw ? normalizePriceTier(tierRaw) : null;
    if (tierRaw && !priceTier) return fail("Choose a valid price tier.");

    const email = text(fd, "email") || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("Enter a valid email address.");
    }

    const websiteParsed = parseSafeHttpUrl(text(fd, "website"));
    if (websiteParsed.error) return fail(websiteParsed.error);

    const contractRaw = text(fd, "contract_status");
    const contractStatus = contractRaw ? normalizeContractStatus(contractRaw) : "NONE";
    if (!contractStatus) return fail("Choose a valid contract status.");

    const cycleRaw = text(fd, "billing_cycle");
    const billingCycle = cycleRaw ? normalizeBillingCycle(cycleRaw) : null;
    if (cycleRaw && !billingCycle) return fail("Choose a valid billing cycle.");

    const dueParsed = parseRealDate(text(fd, "next_due_date"));
    if (!dueParsed.ok) return fail("Enter a valid next due date.");

    let estCost: number | null = null;
    let stdCost: number | null = null;
    if (canViewReports) {
      const estParsed = parseMoney(text(fd, "estimated_cost"));
      if (!estParsed.ok) return fail("Estimated cost must be a valid non-negative TTD amount.");
      estCost = estParsed.value;

      const stdParsed = parseMoney(text(fd, "standard_cost"));
      if (!stdParsed.ok) return fail("Standard rate must be a valid non-negative TTD amount.");
      stdCost = stdParsed.value;
    }

    const turnaround = text(fd, "turnaround") || null;
    const phone = text(fd, "phone") || null;
    const contactPerson = text(fd, "contact_person") || null;
    const address = text(fd, "address") || null;
    const taxId = text(fd, "tax_id") || null;
    const paymentTerms = text(fd, "payment_terms") || null;
    const notes = text(fd, "notes") || null;

    const result = await sql.begin(async (tx) => {
      if (id) {
        const [dup] = await tx<{ id: number }[]>`
          SELECT id FROM vendors
           WHERE lower(name) = lower(${name})
             AND lower(category) = lower(${category})
             AND id <> ${id}
           LIMIT 1`;
        if (dup) {
          return { error: "Another vendor with that name and category already exists." };
        }

        const [updated] = canViewReports
          ? await tx<{ id: number }[]>`
              UPDATE vendors
                 SET category = ${category},
                     service = ${service},
                     name = ${name},
                     phone = ${phone},
                     contact_person = ${contactPerson},
                     email = ${email},
                     notes = ${notes},
                     status = ${status},
                     rating = ${ratingParsed.value},
                     price_tier = ${priceTier},
                     turnaround = ${turnaround},
                     address = ${address},
                     website = ${websiteParsed.url},
                     tax_id = ${taxId},
                     payment_terms = ${paymentTerms},
                     contract_status = ${contractStatus},
                     billing_cycle = ${billingCycle},
                     next_due_date = ${dueParsed.value}::date,
                     estimated_cost = ${estCost},
                     standard_cost = ${stdCost},
                     updated_at = now()
               WHERE id = ${id}
               RETURNING id`
          : await tx<{ id: number }[]>`
              UPDATE vendors
                 SET category = ${category},
                     service = ${service},
                     name = ${name},
                     phone = ${phone},
                     contact_person = ${contactPerson},
                     email = ${email},
                     notes = ${notes},
                     status = ${status},
                     rating = ${ratingParsed.value},
                     price_tier = ${priceTier},
                     turnaround = ${turnaround},
                     address = ${address},
                     website = ${websiteParsed.url},
                     tax_id = ${taxId},
                     payment_terms = ${paymentTerms},
                     contract_status = ${contractStatus},
                     billing_cycle = ${billingCycle},
                     next_due_date = ${dueParsed.value}::date,
                     updated_at = now()
               WHERE id = ${id}
               RETURNING id`;

        if (!updated) return { error: "This vendor no longer exists." };

        await recordAudit(
          {
            user,
            action: "UPDATE",
            entity: "vendor",
            entityId: id,
            details: `${name} (${status})`,
          },
          tx,
        );
        return { ok: true as const, message: "Vendor updated." };
      }

      const [existing] = await tx<{ id: number }[]>`
        SELECT id FROM vendors
         WHERE lower(name) = lower(${name})
           AND lower(category) = lower(${category})
         LIMIT 1`;
      if (existing) {
        return { error: "A vendor with that name and category already exists." };
      }

      const [created] = await tx<{ id: number }[]>`
        INSERT INTO vendors (
          category, service, name, phone, contact_person, email, notes,
          status, rating, price_tier, turnaround, address, website, tax_id,
          payment_terms, contract_status, billing_cycle, next_due_date, estimated_cost, standard_cost
        )
        VALUES (
          ${category}, ${service}, ${name}, ${phone}, ${contactPerson}, ${email}, ${notes},
          ${status}, ${ratingParsed.value}, ${priceTier}, ${turnaround}, ${address}, ${websiteParsed.url}, ${taxId},
          ${paymentTerms}, ${contractStatus}, ${billingCycle}, ${dueParsed.value}::date, ${estCost}, ${stdCost}
        )
        RETURNING id`;

      await recordAudit(
        {
          user,
          action: "CREATE",
          entity: "vendor",
          entityId: created.id,
          details: `${name} (${category})`,
        },
        tx,
      );
      return { ok: true as const, message: "Vendor added." };
    });

    if ("error" in result && result.error) return fail(result.error);

    revalidatePath("/vendors");
    return result;
  } catch (error) {
    return fail(mapVendorDbError(error, "Could not save vendor."));
  }
}

export async function deleteVendorAction(_prev: VendorState, fd: FormData): Promise<VendorState> {
  try {
    const user = await assertPermission("vendors.manage");
    if (user.mustChangePassword) {
      return { error: "Please change your temporary password before making changes." };
    }
    await ensureVendorsSchemaAndSeed();

    const id = parsePositiveIntId(text(fd, "id"));
    if (!id) return { error: "Invalid vendor identifier." };

    const deleted = await sql.begin(async (tx) => {
      const [existing] = await tx<{ id: number; name: string }[]>`
        SELECT id, name FROM vendors WHERE id = ${id} FOR UPDATE`;
      if (!existing) return null;

      // Schema enforces ON DELETE RESTRICT on vendor_engagements.vendor_id, so
      // explicit UI confirmation deletes child engagements atomically first.
      const deletedEngagements = await tx<{ id: number }[]>`
        DELETE FROM vendor_engagements WHERE vendor_id = ${id} RETURNING id`;

      const [row] = await tx<{ id: number; name: string }[]>`
        DELETE FROM vendors WHERE id = ${id} RETURNING id, name`;
      if (!row) return null;

      const engCount = deletedEngagements.length;
      const details =
        engCount > 0
          ? `${row.name} (removed ${engCount} service record${engCount === 1 ? "" : "s"})`
          : row.name;

      await recordAudit(
        {
          user,
          action: "DELETE",
          entity: "vendor",
          entityId: row.id,
          details,
        },
        tx,
      );
      return row;
    });

    if (!deleted) return { error: "Vendor was already deleted or not found." };

    revalidatePath("/vendors");
    return { ok: true, message: `Deleted ${deleted.name}.` };
  } catch (error) {
    return { error: mapVendorDbError(error, "Could not delete vendor.") };
  }
}

export async function saveVendorEngagementAction(
  prev: VendorState,
  fd: FormData,
): Promise<VendorState> {
  const values = collectValues(fd, ENGAGEMENT_FORM_KEYS);
  const fail = (error: string): VendorState => ({
    error,
    values,
    attempt: (prev.attempt ?? 0) + 1,
  });

  try {
    const user = await assertPermission("vendors.manage");
    if (user.mustChangePassword) {
      return fail("Please change your temporary password before making changes.");
    }
    const canViewReports = await can(user.role, "reports.view");
    await ensureVendorsSchemaAndSeed();

    const idRaw = text(fd, "id");
    let id: number | null = null;
    if (idRaw) {
      id = parsePositiveIntId(idRaw);
      if (!id) return fail("Invalid service record identifier.");
    }

    const vendorId = parsePositiveIntId(text(fd, "vendor_id"));
    if (!vendorId) return fail("Select a valid vendor.");

    const title = text(fd, "title");
    if (!title) return fail("Enter a description.");
    if (title.length > 300) return fail("Description must be 300 characters or fewer.");

    const kindRaw = text(fd, "kind").toUpperCase();
    if (!(VALID_ENGAGEMENT_KINDS as readonly string[]).includes(kindRaw)) {
      return fail("Choose a valid record type.");
    }
    const kind = kindRaw as (typeof VALID_ENGAGEMENT_KINDS)[number];

    const statusRaw = text(fd, "status").toUpperCase();
    if (!(VALID_ENGAGEMENT_STATUSES as readonly string[]).includes(statusRaw)) {
      return fail("Choose a valid payment status.");
    }
    const status = statusRaw as (typeof VALID_ENGAGEMENT_STATUSES)[number];

    const engagedRaw = text(fd, "engaged_on");
    const engagedParsed = engagedRaw
      ? parseRealDate(engagedRaw)
      : { ok: true as const, value: trinidadTodayKey() };
    if (!engagedParsed.ok || !engagedParsed.value) {
      return fail("Enter a valid service or bill date.");
    }
    const engagedOn = engagedParsed.value;

    const dueParsed = parseRealDate(text(fd, "due_on"));
    if (!dueParsed.ok) return fail("Enter a valid payment due date.");
    if (dueParsed.value && dueParsed.value < engagedOn) {
      return fail("Payment due date cannot be earlier than the service date.");
    }

    const nextVendorDueParsed = parseRealDate(text(fd, "next_vendor_due_date"));
    if (!nextVendorDueParsed.ok) return fail("Enter a valid next vendor due date.");

    let estCostTtd: number | null = null;
    let amountTtd: number | null = null;
    if (canViewReports) {
      const estParsed = parseMoney(text(fd, "estimated_cost_ttd"));
      if (!estParsed.ok) return fail("Estimated cost must be a valid non-negative TTD amount.");
      estCostTtd = estParsed.value;

      const amountParsed = parseMoney(text(fd, "amount_ttd"));
      if (!amountParsed.ok) return fail("Amount must be a valid non-negative TTD amount.");
      amountTtd = amountParsed.value;
    }

    const referenceNo = text(fd, "reference_no") || null;
    const handledByRaw = text(fd, "handled_by");
    const handledBy = handledByRaw || (id ? null : user.name);
    const notes = text(fd, "notes") || null;

    const result = await sql.begin(async (tx) => {
      const [vendor] = await tx<{ id: number; contract_status: string }[]>`
        SELECT id, contract_status FROM vendors WHERE id = ${vendorId} FOR UPDATE`;
      if (!vendor) return { error: "Selected vendor no longer exists." };

      if (id) {
        const [updated] = canViewReports
          ? await tx<{ id: number }[]>`
              UPDATE vendor_engagements
                 SET vendor_id = ${vendorId},
                     kind = ${kind},
                     title = ${title},
                     reference_no = ${referenceNo},
                     engaged_on = ${engagedOn}::date,
                     due_on = ${dueParsed.value}::date,
                     estimated_cost_ttd = ${estCostTtd},
                     amount_ttd = ${amountTtd},
                     status = ${status},
                     handled_by = ${handledBy},
                     notes = ${notes}
               WHERE id = ${id}
               RETURNING id`
          : await tx<{ id: number }[]>`
              UPDATE vendor_engagements
                 SET vendor_id = ${vendorId},
                     kind = ${kind},
                     title = ${title},
                     reference_no = ${referenceNo},
                     engaged_on = ${engagedOn}::date,
                     due_on = ${dueParsed.value}::date,
                     status = ${status},
                     handled_by = ${handledBy},
                     notes = ${notes}
               WHERE id = ${id}
               RETURNING id`;
        if (!updated) return { error: "Service record no longer exists." };

        await recordAudit(
          {
            user,
            action: "UPDATE",
            entity: "vendor_engagement",
            entityId: id,
            details: `${title} (${kind})`,
          },
          tx,
        );
      } else {
        const [created] = await tx<{ id: number }[]>`
          INSERT INTO vendor_engagements (
            vendor_id, kind, title, reference_no, engaged_on, due_on,
            estimated_cost_ttd, amount_ttd, status, handled_by, notes
          )
          VALUES (
            ${vendorId}, ${kind}, ${title}, ${referenceNo}, ${engagedOn}::date,
            ${dueParsed.value}::date, ${estCostTtd}, ${amountTtd},
            ${status}, ${handledBy}, ${notes}
          )
          RETURNING id`;

        await recordAudit(
          {
            user,
            action: "CREATE",
            entity: "vendor_engagement",
            entityId: created.id,
            details: `${title} (${kind})`,
          },
          tx,
        );
      }

      if (nextVendorDueParsed.value) {
        await tx`
          UPDATE vendors
             SET next_due_date = ${nextVendorDueParsed.value}::date,
                 contract_status = CASE
                   WHEN ${status} = 'QUOTED' THEN contract_status
                   WHEN contract_status = 'RENEWAL_DUE' AND ${kind} = 'UTILITY_BILL' THEN 'RECURRING_UTILITY'
                   WHEN contract_status = 'RENEWAL_DUE' THEN 'ACTIVE_CONTRACT'
                   ELSE contract_status
                 END,
                 updated_at = now()
           WHERE id = ${vendorId}`;
      }

      return { ok: true as const, message: id ? "Record updated." : "Service or bill logged." };
    });

    if ("error" in result && result.error) return fail(result.error);

    revalidatePath("/vendors");
    return result;
  } catch (error) {
    return fail(mapVendorDbError(error, "Could not save service record."));
  }
}

export async function deleteVendorEngagementAction(
  _prev: VendorState,
  fd: FormData,
): Promise<VendorState> {
  try {
    const user = await assertPermission("vendors.manage");
    if (user.mustChangePassword) {
      return { error: "Please change your temporary password before making changes." };
    }
    await ensureVendorsSchemaAndSeed();

    const id = parsePositiveIntId(text(fd, "id"));
    if (!id) return { error: "Invalid service record identifier." };

    const deleted = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number; title: string; kind: string }[]>`
        DELETE FROM vendor_engagements WHERE id = ${id} RETURNING id, title, kind`;
      if (!row) return null;
      await recordAudit(
        {
          user,
          action: "DELETE",
          entity: "vendor_engagement",
          entityId: row.id,
          details: `${row.title} (${row.kind})`,
        },
        tx,
      );
      return row;
    });

    if (!deleted) return { error: "Service record was already deleted or not found." };

    revalidatePath("/vendors");
    return { ok: true, message: "Service record deleted." };
  } catch (error) {
    return { error: mapVendorDbError(error, "Could not delete service record.") };
  }
}

export async function markEngagementPaidAction(fd: FormData): Promise<VendorState> {
  try {
    const user = await assertPermission("vendors.manage");
    if (user.mustChangePassword) {
      return { error: "Please change your temporary password before making changes." };
    }
    await ensureVendorsSchemaAndSeed();

    const id = parsePositiveIntId(text(fd, "id"));
    if (!id) return { error: "Invalid service record identifier." };

    const paidDate = trinidadTodayKey();
    const outcome = await sql.begin(async (tx) => {
      const [existing] = await tx<{ id: number; title: string; kind: string; status: string }[]>`
        SELECT id, title, kind, status
          FROM vendor_engagements
         WHERE id = ${id}
           FOR UPDATE`;
      if (!existing) return { error: "Service record was already deleted or not found." };
      if (existing.status === "PAID") {
        return { ok: true as const, message: "Service record is already marked as paid." };
      }

      await tx`
        UPDATE vendor_engagements
           SET status = 'PAID'
         WHERE id = ${id}`;

      await recordAudit(
        {
          user,
          action: "UPDATE",
          entity: "vendor_engagement",
          entityId: existing.id,
          details: `Marked paid on ${paidDate}: ${existing.title} (${existing.kind})`,
        },
        tx,
      );
      return { ok: true as const, message: `Marked "${existing.title}" as paid.` };
    });

    if ("error" in outcome && outcome.error) return outcome;
    revalidatePath("/vendors");
    return outcome;
  } catch (error) {
    return { error: mapVendorDbError(error, "Could not mark service record as paid.") };
  }
}

/** RFC-4180 CSV parser supporting UTF-8 BOM and quoted multi-line cells. */
function parseCsvRows(rawText: string): string[][] {
  const input = rawText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
    }
    if ("error" in v && v.result === undefined) return "";
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return "";
}

type MappedVendorField =
  | "name"
  | "category"
  | "service"
  | "phone"
  | "contact_person"
  | "email"
  | "status"
  | "rating"
  | "price_tier"
  | "payment_terms"
  | "turnaround"
  | "contract_status"
  | "billing_cycle"
  | "next_due_date"
  | "estimated_cost"
  | "standard_cost"
  | "address"
  | "website"
  | "tax_id"
  | "notes";

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mapPrimaryHeaderField(h: string): MappedVendorField | null {
  if (["vendor", "vendor name", "vendor provider", "provider", "name", "supplier"].includes(h)) {
    return "name";
  }
  if (["category", "group"].includes(h)) return "category";
  if (["service", "specialty", "services"].includes(h)) return "service";
  if (["phone", "telephone", "tel", "mobile"].includes(h)) return "phone";
  if (["contact", "contact person", "rep"].includes(h)) return "contact_person";
  if (["email", "email website", "email address"].includes(h)) return "email";
  if (["status", "approval", "approval status"].includes(h)) return "status";
  if (["rating", "score"].includes(h)) return "rating";
  if (["price tier", "tier"].includes(h)) return "price_tier";
  if (["payment terms", "terms"].includes(h)) return "payment_terms";
  if (["turnaround", "lead time"].includes(h)) return "turnaround";
  if (["contract", "contract status", "contract schedule", "schedule", "schedule status"].includes(h)) {
    return "contract_status";
  }
  if (["billing cycle", "cycle", "frequency"].includes(h)) return "billing_cycle";
  if (["next due date", "due date", "next due"].includes(h)) return "next_due_date";
  if (["estimated cost", "est cost", "est cost ttd", "estimated cost ttd", "cost"].includes(h)) {
    return "estimated_cost";
  }
  if (["standard cost", "standard cost ttd", "standard rate", "standard rate ttd"].includes(h)) {
    return "standard_cost";
  }
  if (["address", "location"].includes(h)) return "address";
  if (["website", "url"].includes(h)) return "website";
  if (["tax id", "tin", "vat"].includes(h)) return "tax_id";
  if (["notes", "note", "comments"].includes(h)) return "notes";
  return null;
}

function resolveHeaderColumns(rawHeaders: string[]): {
  columns: (MappedVendorField | null)[];
  looksLikeHistorySheet: boolean;
} {
  const normalized = rawHeaders.map(normalizeHeader);
  const hasExplicitCategory = normalized.some((h) => h === "category" || h === "group");
  const hasExplicitService = normalized.some(
    (h) => h === "service" || h === "specialty" || h === "services",
  );
  const looksLikeHistorySheet =
    normalized.includes("date") &&
    normalized.includes("type") &&
    normalized.includes("description") &&
    (normalized.includes("reference") || normalized.includes("staff lead"));

  const columns = normalized.map((h): MappedVendorField | null => {
    const primary = mapPrimaryHeaderField(h);
    if (primary) return primary;
    if (h === "type" && !hasExplicitCategory) return "category";
    if (h === "description" && !hasExplicitService) return "service";
    return null;
  });

  return { columns, looksLikeHistorySheet };
}

type ParsedImportRow = {
  lineNo: number;
  fields: Partial<Record<MappedVendorField, string>>;
};

export async function importVendorsAction(
  _prev: VendorState,
  fd: FormData,
): Promise<VendorState> {
  try {
    const user = await assertPermission("stakeholders.manage");
    if (user.mustChangePassword) {
      return { error: "Please change your temporary password before making changes." };
    }
    await ensureVendorsSchemaAndSeed();

    const file = fd.get("vendors_file");
    if (!(file instanceof File) || !file.size) {
      return { error: "Select an .xlsx or .csv file to import." };
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return { error: "Import file is too large (maximum 5 MB)." };
    }

    const fileName = file.name.toLowerCase();
    const parsedRows: ParsedImportRow[] = [];

    if (fileName.endsWith(".csv")) {
      const rows = parseCsvRows(await file.text());
      if (rows.length < 2) return { error: "The CSV file has no vendor rows." };

      let headerIndex = -1;
      let colMap: (MappedVendorField | null)[] = [];
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const resolved = resolveHeaderColumns(rows[i]);
        if (resolved.looksLikeHistorySheet) {
          return {
            error: "That CSV appears to be a Service & spend history sheet, not a Vendor directory.",
          };
        }
        if (resolved.columns.includes("name") && rows[i].length >= 2) {
          headerIndex = i;
          colMap = resolved.columns;
          break;
        }
      }

      if (headerIndex < 0) {
        return { error: "Include a Vendor / Name column header." };
      }

      for (let i = headerIndex + 1; i < rows.length; i++) {
        const cols = rows[i];
        // Multi-dataset CSV exports concatenate sections under a single-cell title row.
        if (
          cols.length === 1 &&
          /^(contracts\s*&\s*utilities|service\s*&\s*spend\s*history)$/i.test(cols[0])
        ) {
          break;
        }
        const fields: Partial<Record<MappedVendorField, string>> = {};
        colMap.forEach((f, idx) => {
          if (f && cols[idx] && fields[f] === undefined) fields[f] = cols[idx];
        });
        if (fields.name) parsedRows.push({ lineNo: i + 1, fields });
      }
    } else if (fileName.endsWith(".xlsx")) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.getWorksheet("Vendors") ?? wb.worksheets[0];
      if (!ws) return { error: "Workbook has no worksheets." };

      let headerRowNum = 0;
      const colMap: Record<number, MappedVendorField> = {};
      for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
        const rowCells: { col: number; text: string }[] = [];
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
          rowCells.push({ col, text: cellText(cell.value) });
        });
        if (rowCells.length < 2) continue;

        const maxCol = Math.max(...rowCells.map((c) => c.col));
        const rawHeaders = Array.from({ length: maxCol }, (_, idx) => {
          const found = rowCells.find((c) => c.col === idx + 1);
          return found ? found.text : "";
        });
        const resolved = resolveHeaderColumns(rawHeaders);
        if (resolved.looksLikeHistorySheet) {
          return {
            error:
              "That worksheet appears to be Service & spend history. Upload a Vendor directory worksheet.",
          };
        }
        if (resolved.columns.includes("name")) {
          headerRowNum = r;
          resolved.columns.forEach((field, idx) => {
            if (field) colMap[idx + 1] = field;
          });
          break;
        }
      }

      if (!headerRowNum) {
        return { error: "Could not find a Vendor / Name column header in the sheet." };
      }

      for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
        const fields: Partial<Record<MappedVendorField, string>> = {};
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
          const f = colMap[col];
          const val = cellText(cell.value);
          if (f && val && fields[f] === undefined) fields[f] = val;
        });
        if (fields.name) parsedRows.push({ lineNo: r, fields });
      }
    } else {
      return { error: "Only .xlsx and .csv files are supported." };
    }

    if (parsedRows.length === 0) {
      return { error: "No valid vendor rows found in that file." };
    }

    type ValidatedImportRow = {
      name: string;
      category: string | null;
      service: string | null;
      phone: string | null;
      contact_person: string | null;
      email: string | null;
      address: string | null;
      website: string | null;
      tax_id: string | null;
      payment_terms: string | null;
      turnaround: string | null;
      status: (typeof VALID_VENDOR_STATUSES)[number] | null;
      rating: number | null;
      price_tier: (typeof VALID_PRICE_TIERS)[number] | null;
      contract_status: (typeof VALID_CONTRACT_STATUSES)[number] | null;
      billing_cycle: (typeof VALID_BILLING_CYCLES)[number] | null;
      next_due_date: string | null;
      estimated_cost: number | null;
      standard_cost: number | null;
      notes: string | null;
    };

    const validatedRows: ValidatedImportRow[] = [];
    for (const { lineNo, fields: row } of parsedRows) {
      const cleanName = row.name!.trim();
      if (!cleanName || cleanName.length > 200) {
        return { error: `Row ${lineNo}: vendor name is empty or exceeds 200 characters.` };
      }

      const status = row.status ? normalizeVendorStatus(row.status) : null;
      if (row.status && !status) {
        return { error: `Row ${lineNo}: invalid status "${row.status}".` };
      }

      const ratingParsed = parseRating(row.rating ?? "");
      if (!ratingParsed.ok) {
        return { error: `Row ${lineNo}: rating "${row.rating}" must be 1–5.` };
      }

      const priceTier = row.price_tier ? normalizePriceTier(row.price_tier) : null;
      if (row.price_tier && !priceTier) {
        return { error: `Row ${lineNo}: invalid price tier "${row.price_tier}".` };
      }

      const contractStatus = row.contract_status
        ? normalizeContractStatus(row.contract_status)
        : null;
      if (row.contract_status && !contractStatus) {
        return { error: `Row ${lineNo}: invalid contract status "${row.contract_status}".` };
      }

      const billingCycle = row.billing_cycle ? normalizeBillingCycle(row.billing_cycle) : null;
      if (row.billing_cycle && !billingCycle) {
        return { error: `Row ${lineNo}: invalid billing cycle "${row.billing_cycle}".` };
      }

      const dueParsed = parseRealDate(row.next_due_date ?? "", true);
      if (!dueParsed.ok) {
        return { error: `Row ${lineNo}: invalid next due date "${row.next_due_date}".` };
      }

      const estParsed = parseMoney(row.estimated_cost ?? "");
      if (!estParsed.ok) {
        return { error: `Row ${lineNo}: invalid estimated cost "${row.estimated_cost}".` };
      }

      const stdParsed = parseMoney(row.standard_cost ?? "");
      if (!stdParsed.ok) {
        return { error: `Row ${lineNo}: invalid standard cost "${row.standard_cost}".` };
      }

      const websiteParsed = parseSafeHttpUrl(row.website);
      if (websiteParsed.error) {
        return { error: `Row ${lineNo}: ${websiteParsed.error}` };
      }

      validatedRows.push({
        name: cleanName,
        category: row.category?.trim() || null,
        service: row.service?.trim() || null,
        phone: row.phone?.trim() || null,
        contact_person: row.contact_person?.trim() || null,
        email: row.email?.trim() || null,
        address: row.address?.trim() || null,
        website: websiteParsed.url,
        tax_id: row.tax_id?.trim() || null,
        payment_terms: row.payment_terms?.trim() || null,
        turnaround: row.turnaround?.trim() || null,
        status,
        rating: ratingParsed.value,
        price_tier: priceTier,
        contract_status: contractStatus,
        billing_cycle: billingCycle,
        next_due_date: dueParsed.value,
        estimated_cost: estParsed.value,
        standard_cost: stdParsed.value,
        notes: row.notes?.trim() || null,
      });
    }

    const { added, updated } = await sql.begin(async (tx) => {
      const existing = await tx<{ id: number; name: string; category: string }[]>`
        SELECT id, name, category FROM vendors FOR UPDATE`;

      const byNameAndCat = new Map<string, number>();
      const byName = new Map<string, number[]>();
      for (const v of existing) {
        const nKey = v.name.trim().toLowerCase();
        const cKey = v.category.trim().toLowerCase();
        byNameAndCat.set(`${nKey}::${cKey}`, v.id);
        const list = byName.get(nKey) ?? [];
        list.push(v.id);
        byName.set(nKey, list);
      }

      let addedCount = 0;
      let updatedCount = 0;

      for (const item of validatedRows) {
        const nKey = item.name.toLowerCase();
        const cKey = (item.category ?? "Other").toLowerCase();
        let matchId = byNameAndCat.get(`${nKey}::${cKey}`);
        if (!matchId) {
          const nameMatches = byName.get(nKey);
          if (nameMatches && nameMatches.length === 1) {
            matchId = nameMatches[0];
          }
        }

        if (matchId) {
          await tx`
            UPDATE vendors
               SET category = COALESCE(${item.category}, category),
                   service = COALESCE(${item.service}, service),
                   phone = COALESCE(${item.phone}, phone),
                   contact_person = COALESCE(${item.contact_person}, contact_person),
                   email = COALESCE(${item.email}, email),
                   address = COALESCE(${item.address}, address),
                   website = COALESCE(${item.website}, website),
                   tax_id = COALESCE(${item.tax_id}, tax_id),
                   payment_terms = COALESCE(${item.payment_terms}, payment_terms),
                   turnaround = COALESCE(${item.turnaround}, turnaround),
                   status = COALESCE(${item.status}, status),
                   rating = COALESCE(${item.rating}, rating),
                   price_tier = COALESCE(${item.price_tier}, price_tier),
                   contract_status = COALESCE(${item.contract_status}, contract_status),
                   billing_cycle = COALESCE(${item.billing_cycle}, billing_cycle),
                   next_due_date = COALESCE(${item.next_due_date}::date, next_due_date),
                   estimated_cost = COALESCE(${item.estimated_cost}, estimated_cost),
                   standard_cost = COALESCE(${item.standard_cost}, standard_cost),
                   notes = COALESCE(${item.notes}, notes),
                   updated_at = now()
             WHERE id = ${matchId}`;
          updatedCount++;
        } else {
          const [created] = await tx<{ id: number }[]>`
            INSERT INTO vendors (
              category, service, name, phone, contact_person, email,
              address, website, tax_id, payment_terms, turnaround, status,
              rating, price_tier, contract_status, billing_cycle,
              next_due_date, estimated_cost, standard_cost, notes
            )
            VALUES (
              ${item.category || "Other"}, ${item.service}, ${item.name},
              ${item.phone}, ${item.contact_person}, ${item.email},
              ${item.address}, ${item.website}, ${item.tax_id},
              ${item.payment_terms}, ${item.turnaround}, ${item.status ?? "APPROVED"},
              ${item.rating}, ${item.price_tier}, ${item.contract_status ?? "NONE"},
              ${item.billing_cycle}, ${item.next_due_date}::date,
              ${item.estimated_cost}, ${item.standard_cost}, ${item.notes}
            )
            RETURNING id`;
          byNameAndCat.set(`${nKey}::${cKey}`, created.id);
          const list = byName.get(nKey) ?? [];
          list.push(created.id);
          byName.set(nKey, list);
          addedCount++;
        }
      }

      await recordAudit(
        {
          user,
          action: "IMPORT",
          entity: "vendor",
          details: `${file.name}: ${addedCount} added, ${updatedCount} updated`,
        },
        tx,
      );

      return { added: addedCount, updated: updatedCount };
    });

    revalidatePath("/vendors");
    return {
      ok: true,
      message: `Imported ${validatedRows.length} vendor rows (${added} added, ${updated} updated).`,
    };
  } catch (error) {
    return { error: mapVendorDbError(error, "Could not import vendors.") };
  }
}
