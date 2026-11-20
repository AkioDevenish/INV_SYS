import "server-only";
import type postgres from "postgres";
import { sql } from "./db";

export type VendorStatus = "PREFERRED" | "APPROVED" | "ON_HOLD" | "INACTIVE";
export type ContractStatus = "NONE" | "ACTIVE_CONTRACT" | "RECURRING_UTILITY" | "RENEWAL_DUE";
export type PriceTier = "BUDGET" | "STANDARD" | "PREMIUM";
export type BillingCycle = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ON_DEMAND";
export type EngagementKind = "QUOTE" | "PO" | "INVOICE" | "UTILITY_BILL" | "SERVICE";
export type EngagementStatus = "QUOTED" | "APPROVED" | "PENDING_PAYMENT" | "PAID";

export type VendorItem = {
  id: number;
  category: string;
  service: string | null;
  name: string;
  phone: string | null;
  contact_person: string | null;
  email: string | null;
  notes: string | null;
  status: VendorStatus;
  rating: number | null;
  price_tier: PriceTier | null;
  turnaround: string | null;
  address: string | null;
  website: string | null;
  tax_id: string | null;
  payment_terms: string | null;
  contract_status: ContractStatus;
  billing_cycle: BillingCycle | null;
  next_due_date: string | null;
  estimated_cost: number | null;
  standard_cost: number | null;
  engagement_count: number;
  total_spend_ttd: number;
  pending_spend_ttd: number;
  quoted_ttd: number;
  last_engaged_on: string | null;
  updated_at: string;
};

export type VendorEngagementItem = {
  id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_category: string;
  kind: EngagementKind;
  title: string;
  reference_no: string | null;
  engaged_on: string;
  due_on: string | null;
  estimated_cost_ttd: number | null;
  amount_ttd: number | null;
  status: EngagementStatus;
  handled_by: string | null;
  notes: string | null;
  created_at: string;
};

type Tx = postgres.TransactionSql;

let schemaChecked = false;
let schemaCheckPromise: Promise<void> | null = null;

/**
 * Schema DDL lives in `src/lib/schema.mjs`, not on request paths.
 * Demo vendor metadata mutations and sample engagement seeding are disabled by
 * default and only run when explicitly opted in via `ALLOW_DEMO_VENDOR_SEED=true`.
 */
export async function ensureVendorsSchemaAndSeed(): Promise<void> {
  if (schemaChecked) return;
  if (process.env.ALLOW_DEMO_VENDOR_SEED !== "true") {
    schemaChecked = true;
    return;
  }
  if (!schemaCheckPromise) {
    schemaCheckPromise = (async () => {
      const [{ has_engagements, has_seed }] = await sql<
        { has_engagements: boolean; has_seed: boolean }[]
      >`
        SELECT EXISTS (SELECT 1 FROM vendor_engagements) AS has_engagements,
               EXISTS (SELECT 1 FROM audit_logs WHERE entity IN ('vendor_engagement', 'vendor_seed')) AS has_seed`;

      if (!has_engagements && !has_seed) {
        await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(928371)`;
          const [recheck] = await tx<{ has_engagements: boolean; has_seed: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM vendor_engagements) AS has_engagements,
                   EXISTS (SELECT 1 FROM audit_logs WHERE entity IN ('vendor_engagement', 'vendor_seed')) AS has_seed`;
          if (!recheck.has_engagements && !recheck.has_seed) {
            await seedVendorMetadataAndEngagements(tx);
            await tx`
              INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
              VALUES (NULL, 'system', 'SEED', 'vendor_seed', NULL, 'Seeded baseline vendor metadata and engagements')`;
          }
        });
      }
      schemaChecked = true;
    })().finally(() => {
      schemaCheckPromise = null;
    });
  }
  await schemaCheckPromise;
}

async function seedVendorMetadataAndEngagements(tx: Tx): Promise<void> {
  const existingVendors = await tx<{ id: number; name: string; category: string }[]>`
    SELECT id, name, category FROM vendors`;
  if (existingVendors.length === 0) return;

  const findVendor = (pattern: RegExp) =>
    existingVendors.find((v) => pattern.test(v.name));

  // 1. Default baseline for existing approved vendors without custom metadata
  await tx`
    UPDATE vendors
       SET price_tier = COALESCE(price_tier, 'STANDARD'),
           rating = COALESCE(rating, 4),
           payment_terms = COALESCE(payment_terms, 'Net 15')
     WHERE status = 'APPROVED'`;

  // 2. Reclassify IICA-TT recurring utilities and assign billing cycles & upcoming due dates
  const utilityConfigs: {
    match: RegExp;
    service?: string;
    due: string;
    cost: number;
    terms: string;
    notes: string;
  }[] = [
    {
      match: /^WASA$/i,
      service: "Water supply",
      due: "2026-11-28",
      cost: 650,
      terms: "Monthly utility",
      notes: "St. Augustine office water service",
    },
    {
      match: /^T&TEC$/i,
      service: "Electricity supply",
      due: "2026-11-25",
      cost: 3450,
      terms: "Monthly utility",
      notes: "Main office electricity account",
    },
    {
      match: /^FLOW$/i,
      service: "Fibre internet & office lines",
      due: "2026-11-22",
      cost: 1850,
      terms: "Monthly billing",
      notes: "Primary office internet & backup phone line",
    },
    {
      match: /^TSTT$/i,
      service: "Telecommunications",
      due: "2026-12-01",
      cost: 1200,
      terms: "Monthly billing",
      notes: "Fixed office voice & PABX lines",
    },
    {
      match: /^Digicel$/i,
      service: "Mobile & field data plans",
      due: "2026-12-05",
      cost: 950,
      terms: "Monthly billing",
      notes: "Staff field communication plans",
    },
  ];

  for (const cfg of utilityConfigs) {
    const v = findVendor(cfg.match);
    if (!v) continue;
    await tx`
      UPDATE vendors
         SET category = CASE WHEN category IN ('Other', '') THEN 'Utilities' ELSE category END,
             service = COALESCE(service, ${cfg.service ?? null}),
             rating = COALESCE(rating, 4),
             price_tier = COALESCE(price_tier, 'STANDARD'),
             contract_status = CASE WHEN contract_status = 'NONE' THEN 'RECURRING_UTILITY' ELSE contract_status END,
             billing_cycle = COALESCE(billing_cycle, 'MONTHLY'),
             next_due_date = COALESCE(next_due_date, ${cfg.due}::date),
             estimated_cost = COALESCE(estimated_cost, ${cfg.cost}),
             payment_terms = COALESCE(payment_terms, ${cfg.terms}),
             notes = COALESCE(notes, ${cfg.notes})
       WHERE id = ${v.id}`;
  }

  // 3. Facilities & Vehicle maintenance/insurance contracts
  const contractConfigs: {
    match: RegExp;
    contractStatus: ContractStatus;
    cycle: BillingCycle;
    due: string;
    cost: number;
    turnaround: string;
    terms: string;
  }[] = [
    {
      match: /\bRentokil\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "QUARTERLY",
      due: "2026-12-12",
      cost: 1800,
      turnaround: "Scheduled quarterly",
      terms: "Net 30",
    },
    {
      match: /\bGenuine Technologies\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "QUARTERLY",
      due: "2026-11-30",
      cost: 2400,
      turnaround: "48 hours",
      terms: "Net 30",
    },
    {
      match: /\bInterChem\b/i,
      contractStatus: "RENEWAL_DUE",
      cycle: "ANNUAL",
      due: "2026-11-26",
      cost: 3200,
      turnaround: "1 week",
      terms: "Net 30",
    },
    {
      match: /\bAll Pro\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "QUARTERLY",
      due: "2027-01-10",
      cost: 2100,
      turnaround: "Same day emergency",
      terms: "Net 30",
    },
    {
      match: /\bColfire\b/i,
      contractStatus: "RENEWAL_DUE",
      cycle: "ANNUAL",
      due: "2026-11-29",
      cost: 8400,
      turnaround: "Annual renewal",
      terms: "Prepaid annual",
    },
    {
      match: /\bHSM\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "QUARTERLY",
      due: "2026-12-18",
      cost: 2600,
      turnaround: "1-2 days",
      terms: "Cheque on completion",
    },
    {
      match: /\bTwin Isle Adjusters\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "ANNUAL",
      due: "2027-02-01",
      cost: 900,
      turnaround: "3 business days",
      terms: "Upon report",
    },
    {
      match: /\bFrank's Body\b/i,
      contractStatus: "ACTIVE_CONTRACT",
      cycle: "ON_DEMAND",
      due: "2026-12-20",
      cost: 3800,
      turnaround: "Same day",
      terms: "Upon service",
    },
  ];

  for (const cfg of contractConfigs) {
    const v = findVendor(cfg.match);
    if (!v) continue;
    await tx`
      UPDATE vendors
         SET status = CASE WHEN status = 'APPROVED' THEN 'PREFERRED' ELSE status END,
             rating = COALESCE(rating, 5),
             contract_status = CASE WHEN contract_status = 'NONE' THEN ${cfg.contractStatus} ELSE contract_status END,
             billing_cycle = COALESCE(billing_cycle, ${cfg.cycle}),
             next_due_date = COALESCE(next_due_date, ${cfg.due}::date),
             estimated_cost = COALESCE(estimated_cost, ${cfg.cost}),
             turnaround = COALESCE(turnaround, ${cfg.turnaround}),
             payment_terms = COALESCE(payment_terms, ${cfg.terms})
       WHERE id = ${v.id}`;
  }

  // 4. Mark preferred operational vendors across Catering, Printing, IT, Hotels & Groceries
  const preferredConfigs: {
    match: RegExp;
    priceTier: PriceTier;
    turnaround: string;
    terms: string;
    service?: string;
  }[] = [
    { match: /\bBerment Caterers\b/i, priceTier: "STANDARD", turnaround: "48 hours notice", terms: "Net 15" },
    { match: /\bJappy's Catering\b/i, priceTier: "STANDARD", turnaround: "24-48 hours notice", terms: "Upon delivery", service: "Workshop lunches & refreshments" },
    { match: /\bASL Catering\b/i, priceTier: "STANDARD", turnaround: "48 hours notice", terms: "Net 15", service: "Event catering" },
    { match: /\bKaribgraphics\b/i, priceTier: "STANDARD", turnaround: "3-5 business days", terms: "Net 30" },
    { match: /\bEniath\b/i, priceTier: "STANDARD", turnaround: "5 business days", terms: "Net 30", service: "Publications & report printing" },
    { match: /\bHyatt Regency\b/i, priceTier: "PREMIUM", turnaround: "Quote within 24h", terms: "LPO / Net 30", service: "Conferences & stakeholder events" },
    { match: /\bUniversity Inn\b/i, priceTier: "BUDGET", turnaround: "24 hours", terms: "Net 15", service: "Seminars & accommodation" },
    { match: /\bMichael Sears\b/i, priceTier: "STANDARD", turnaround: "Same day / 24h", terms: "Net 15" },
    { match: /\bDiamond Systems\b/i, priceTier: "STANDARD", turnaround: "2-5 business days", terms: "Net 30" },
    { match: /\bPriceSmart\b/i, priceTier: "BUDGET", turnaround: "Same day pickup", terms: "Office card / cheque" },
    { match: /\bFraites\b/i, priceTier: "STANDARD", turnaround: "Next day delivery", terms: "Net 15" },
    { match: /\bTTPost\b/i, priceTier: "BUDGET", turnaround: "Annual box renewal", terms: "Annual fee" },
    { match: /\bTOPS\b/i, priceTier: "STANDARD", turnaround: "1-2 business days", terms: "Net 15" },
    { match: /\bRM Visuals\b/i, priceTier: "STANDARD", turnaround: "3-5 business days", terms: "50% deposit / completion" },
  ];

  for (const cfg of preferredConfigs) {
    const v = findVendor(cfg.match);
    if (!v) continue;
    await tx`
      UPDATE vendors
         SET status = CASE WHEN status = 'APPROVED' THEN 'PREFERRED' ELSE status END,
             rating = COALESCE(rating, 5),
             price_tier = COALESCE(price_tier, ${cfg.priceTier}),
             turnaround = COALESCE(turnaround, ${cfg.turnaround}),
             payment_terms = COALESCE(payment_terms, ${cfg.terms}),
             service = COALESCE(service, ${cfg.service ?? null})
       WHERE id = ${v.id}`;
  }

  // 5. Seed initial service, invoice & utility payment history linked to real vendors
  const engagementSeeds: {
    match: RegExp;
    kind: EngagementKind;
    title: string;
    ref: string;
    engagedOn: string;
    dueOn: string | null;
    amount: number;
    status: EngagementStatus;
    handledBy: string;
    notes: string;
  }[] = [
    {
      match: /^T&TEC$/i,
      kind: "UTILITY_BILL",
      title: "October electricity bill",
      ref: "TTEC-2026-10",
      engagedOn: "2026-10-28",
      dueOn: "2026-11-25",
      amount: 3420.5,
      status: "PAID",
      handledBy: "Junnel Lewis",
      notes: "Paid by cheque; November cycle due Nov 25",
    },
    {
      match: /^FLOW$/i,
      kind: "UTILITY_BILL",
      title: "Monthly fibre internet & voice lines",
      ref: "FLOW-2026-11",
      engagedOn: "2026-11-03",
      dueOn: "2026-11-22",
      amount: 1850,
      status: "PENDING_PAYMENT",
      handledBy: "Junnel Lewis",
      notes: "Included on Payments4Processing listing",
    },
    {
      match: /^WASA$/i,
      kind: "UTILITY_BILL",
      title: "Q4 office water charges",
      ref: "WASA-2026-10",
      engagedOn: "2026-10-20",
      dueOn: "2026-11-28",
      amount: 645,
      status: "PAID",
      handledBy: "Salisha Estrada",
      notes: "Settled at St. Augustine commercial desk",
    },
    {
      match: /Genuine Technologies/i,
      kind: "SERVICE",
      title: "Conference room & admin AC unit servicing",
      ref: "GT-INV-418",
      engagedOn: "2026-10-14",
      dueOn: null,
      amount: 2400,
      status: "PAID",
      handledBy: "Edwin Franco",
      notes: "Filters cleaned and refrigerant checked for all 6 units",
    },
    {
      match: /Rentokil/i,
      kind: "SERVICE",
      title: "Quarterly pest control treatment",
      ref: "RNK-8821",
      engagedOn: "2026-09-12",
      dueOn: "2026-12-12",
      amount: 1800,
      status: "PAID",
      handledBy: "Edwin Franco",
      notes: "Next quarterly treatment scheduled Dec 12",
    },
    {
      match: /Berment Caterers/i,
      kind: "INVOICE",
      title: "GCF Closing Workshop lunch & coffee breaks (45 pax)",
      ref: "BC-2026-112",
      engagedOn: "2026-11-11",
      dueOn: "2026-11-26",
      amount: 6750,
      status: "PENDING_PAYMENT",
      handledBy: "Geselle Hodge",
      notes: "Full hot lunch and afternoon tea for workshop participants",
    },
    {
      match: /Jappy's Catering/i,
      kind: "INVOICE",
      title: "Farmers' Group Governance Training lunch boxes",
      ref: "JC-309",
      engagedOn: "2026-11-11",
      dueOn: null,
      amount: 3250,
      status: "PAID",
      handledBy: "Richard Rampersaud",
      notes: "Delivered on time to training venue",
    },
    {
      match: /Karibgraphics/i,
      kind: "INVOICE",
      title: "Banners & folders for Agri-food Systems training",
      ref: "KG-1904",
      engagedOn: "2026-11-05",
      dueOn: null,
      amount: 2890,
      status: "PAID",
      handledBy: "Geselle Hodge",
      notes: "2 pull-up banners and 60 branded training folders",
    },
    {
      match: /Eniath/i,
      kind: "QUOTE",
      title: "2026 Knowledge Products booklet print quote (150 copies)",
      ref: "ENP-Q-221",
      engagedOn: "2026-11-12",
      dueOn: "2026-11-27",
      amount: 5400,
      status: "APPROVED",
      handledBy: "Mercedes Archer",
      notes: "Awaiting final proof approval before press run",
    },
    {
      match: /PriceSmart/i,
      kind: "INVOICE",
      title: "Office pantry, coffee & meeting bottled water restock",
      ref: "PS-9941",
      engagedOn: "2026-11-06",
      dueOn: null,
      amount: 1485.75,
      status: "PAID",
      handledBy: "Edwin Franco",
      notes: "Monthly replenishment",
    },
    {
      match: /Fraites/i,
      kind: "INVOICE",
      title: "Sanitation & bathroom cleaning supplies",
      ref: "FR-5512",
      engagedOn: "2026-10-29",
      dueOn: null,
      amount: 1120,
      status: "PAID",
      handledBy: "Edwin Franco",
      notes: "Paper towels, soap dispensers, disinfectant",
    },
    {
      match: /Colfire/i,
      kind: "QUOTE",
      title: "Annual office vehicle comprehensive insurance renewal",
      ref: "CF-REN-2026",
      engagedOn: "2026-11-10",
      dueOn: "2026-11-29",
      amount: 8400,
      status: "PENDING_PAYMENT",
      handledBy: "Junnel Lewis",
      notes: "Renewal quote received; cheque requested",
    },
    {
      match: /Michael Sears/i,
      kind: "SERVICE",
      title: "Conference projector & staff laptop SSD maintenance",
      ref: "MS-2026-09",
      engagedOn: "2026-10-18",
      dueOn: null,
      amount: 1950,
      status: "PAID",
      handledBy: "Akio Devenish",
      notes: "Quick turnaround and warranty diagnostics",
    },
    {
      match: /University Inn/i,
      kind: "PO",
      title: "Regional Technical Planning workshop room booking",
      ref: "UWI-PO-78",
      engagedOn: "2026-10-25",
      dueOn: null,
      amount: 4600,
      status: "PAID",
      handledBy: "Lisa Harrynanan",
      notes: "Conference room + AV setup",
    },
  ];

  for (const item of engagementSeeds) {
    const v = findVendor(item.match);
    if (!v) continue;
    await tx`
      INSERT INTO vendor_engagements
        (vendor_id, kind, title, reference_no, engaged_on, due_on, amount_ttd, status, handled_by, notes)
      VALUES
        (${v.id}, ${item.kind}, ${item.title}, ${item.ref}, ${item.engagedOn}::date,
         ${item.dueOn}::date, ${item.amount}, ${item.status}, ${item.handledBy}, ${item.notes})`;
  }
}

export async function listVendorsWithStats(): Promise<{
  vendors: VendorItem[];
  engagements: VendorEngagementItem[];
}> {
  await ensureVendorsSchemaAndSeed();

  const [vendorRows, engagementRows] = await Promise.all([
    sql<{
      id: number;
      category: string;
      service: string | null;
      name: string;
      phone: string | null;
      contact_person: string | null;
      email: string | null;
      notes: string | null;
      status: VendorStatus;
      rating: number | null;
      price_tier: PriceTier | null;
      turnaround: string | null;
      address: string | null;
      website: string | null;
      tax_id: string | null;
      payment_terms: string | null;
      contract_status: ContractStatus;
      billing_cycle: BillingCycle | null;
      next_due_date: Date | null;
      estimated_cost: number | null;
      standard_cost: number | null;
      engagement_count: number;
      total_spend_ttd: number;
      pending_spend_ttd: number;
      quoted_ttd: number;
      last_engaged_on: Date | null;
      updated_at: Date;
    }[]>`
      SELECT v.id,
             v.category,
             v.service,
             v.name,
             v.phone,
             v.contact_person,
             v.email,
             v.notes,
             v.status,
             v.rating,
             v.price_tier,
             v.turnaround,
             v.address,
             v.website,
             v.tax_id,
             v.payment_terms,
             v.contract_status,
             v.billing_cycle,
             v.next_due_date,
             v.estimated_cost::float8 AS estimated_cost,
             v.standard_cost::float8 AS standard_cost,
             COUNT(e.id)::int AS engagement_count,
             COALESCE(SUM(CASE WHEN e.status = 'PAID' THEN COALESCE(e.amount_ttd, 0) ELSE 0 END), 0)::float8 AS total_spend_ttd,
             COALESCE(SUM(CASE WHEN e.status IN ('APPROVED', 'PENDING_PAYMENT') AND e.kind <> 'QUOTE' THEN COALESCE(e.amount_ttd, 0) ELSE 0 END), 0)::float8 AS pending_spend_ttd,
             COALESCE(SUM(CASE WHEN e.kind = 'QUOTE' AND e.status <> 'PAID' THEN COALESCE(e.amount_ttd, e.estimated_cost_ttd, 0) ELSE 0 END), 0)::float8 AS quoted_ttd,
             MAX(e.engaged_on) AS last_engaged_on,
             v.updated_at
        FROM vendors v
        LEFT JOIN vendor_engagements e ON e.vendor_id = v.id
       GROUP BY v.id
       ORDER BY
         CASE v.status WHEN 'PREFERRED' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'ON_HOLD' THEN 2 ELSE 3 END,
         lower(v.category),
         lower(v.name)`,
    sql<{
      id: number;
      vendor_id: number;
      vendor_name: string;
      vendor_category: string;
      kind: EngagementKind;
      title: string;
      reference_no: string | null;
      engaged_on: Date;
      due_on: Date | null;
      estimated_cost_ttd: number | null;
      amount_ttd: number | null;
      status: EngagementStatus;
      handled_by: string | null;
      notes: string | null;
      created_at: Date;
    }[]>`
      SELECT e.id,
             e.vendor_id,
             v.name AS vendor_name,
             v.category AS vendor_category,
             e.kind,
             e.title,
             e.reference_no,
             e.engaged_on,
             e.due_on,
             e.estimated_cost_ttd::float8 AS estimated_cost_ttd,
             e.amount_ttd::float8 AS amount_ttd,
             e.status,
             e.handled_by,
             e.notes,
             e.created_at
        FROM vendor_engagements e
        JOIN vendors v ON v.id = e.vendor_id
       ORDER BY e.engaged_on DESC, e.id DESC`,
  ]);

  const toDateStr = (d: Date | string | null | undefined): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
  };

  return {
    vendors: vendorRows.map((v) => ({
      ...v,
      next_due_date: toDateStr(v.next_due_date),
      last_engaged_on: toDateStr(v.last_engaged_on),
      updated_at: v.updated_at instanceof Date ? v.updated_at.toISOString() : String(v.updated_at),
    })),
    engagements: engagementRows.map((e) => ({
      ...e,
      engaged_on: toDateStr(e.engaged_on) ?? "",
      due_on: toDateStr(e.due_on),
      created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
    })),
  };
}
