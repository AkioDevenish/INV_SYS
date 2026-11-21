#!/usr/bin/env node
/**
 * Imports the IICA-TT stakeholder workbook into the stakeholders table.
 *
 *   node scripts/import-stakeholders.mjs "IICA-TT Stakeholder Listing.xlsx"
 *   node scripts/import-stakeholders.mjs --replace path/to/workbook.xlsx
 *   node scripts/import-stakeholders.mjs --dry-run path/to/workbook.xlsx
 *   node scripts/import-stakeholders.mjs --skipped-file skipped.txt path/to/workbook.xlsx
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { cellText, createScriptSql, fail, loadEnvFiles, resolveDatabaseUrl } from "./_lib.mjs";

const SHEETS = [
  {
    sheet: "CCRAF",
    group: "CCRAF",
    description: "Caribbean Climate-Resilient Agriculture Forum contacts.",
    from: 3,
    map: (c) => ({
      name: join(c("A"), c("B")),
      email: c("C"),
      organisation: c("D"),
      job_title: c("E"),
      location: c("F"),
      gender: c("G"),
      age_group: c("H"),
    }),
  },
  {
    sheet: "Other Ministries",
    group: "Other Ministries",
    description: "Government ministries outside MALF.",
    from: 2,
    map: (c) => ({
      organisation: c("A"),
      job_title: c("C"),
      name: c("D"),
      phone: c("G"),
      alt_phone: c("H"),
      email: c("I"),
      alt_email: c("J"),
      notes: labelled([["Acronym", c("B")], ["Area of specialty", c("F")]]),
    }),
  },
  {
    sheet: "AgriMSEs",
    group: "Agri MSEs",
    description: "Micro and small agricultural enterprises.",
    from: 3,
    map: businessContacts,
  },
  {
    sheet: "Diplomatic Corp",
    group: "Diplomatic Corps",
    description: "Embassies, high commissions and heads of mission.",
    from: 3,
    map: (c) => ({
      organisation: c("A"),
      job_title: c("B"),
      name: c("C"),
      phone: c("D"),
      alt_phone: c("E"),
      email: c("F"),
      alt_email: c("G"),
    }),
  },
  {
    sheet: "MALF",
    group: "MALF",
    description: "Ministry of Agriculture, Land and Fisheries.",
    from: 3,
    map: (c) => ({
      organisation: "Ministry of Agriculture, Land and Fisheries",
      job_title: join(c("B"), c("A")),
      name: c("C"),
      phone: c("E"),
      alt_phone: c("F"),
      email: c("G"),
      alt_email: c("H"),
      notes: labelled([["Area of specialty", c("D")]]),
    }),
  },
  {
    sheet: "Home Gardeners",
    group: "Home Gardeners",
    description: "Household and backyard growers.",
    from: 3,
    map: (c) => ({
      name: c("A"),
      location: c("B"),
      phone: c("C"),
      email: c("D"),
      age_group: c("F"),
    }),
  },
  {
    sheet: "Beekeepers",
    group: "Beekeepers",
    description: "Apiarists and beekeeping operations.",
    from: 3,
    map: (c) => ({
      name: c("A"),
      organisation: c("B"),
      job_title: c("C"),
      location: c("D"),
      phone: c("E"),
      email: c("F"),
      gender: c("G"),
      age_group: c("H"),
    }),
  },
  {
    sheet: "Dev.Partners",
    group: "Development Partners",
    description: "State agencies and development partners.",
    from: 3,
    map: (c) => ({
      organisation: c("A"),
      job_title: c("C"),
      name: c("D"),
      phone: c("E"),
      alt_phone: c("F"),
      email: c("G"),
      alt_email: c("H"),
      notes: labelled([["Line ministry", c("B")]]),
    }),
  },
  {
    sheet: "Private Sector",
    group: "Private Sector",
    description: "Private sector companies and corporate partners.",
    from: 3,
    map: businessContacts,
  },
  {
    sheet: "Local Chamber of Commerce",
    group: "Chambers of Commerce",
    description: "Local and regional chambers of commerce.",
    from: 3,
    map: businessContacts,
  },
  {
    sheet: "NGOs-CBOs",
    group: "NGOs & CBOs",
    description: "Non-governmental and community-based organisations.",
    from: 3,
    map: (c) => ({
      organisation: c("A"),
      name: c("C"),
      phone: c("D"),
      email: c("E"),
      website: c("F"),
      social: labelled([["Facebook", c("G")], ["Instagram", c("H")]]),
      notes: labelled([["Acronym", c("B")]]),
    }),
  },
  {
    sheet: "Farmer Database",
    group: "Farmers",
    description: "Individual registered farmers.",
    from: 3,
    map: (c) => ({ name: c("A"), phone: c("B"), email: c("C") }),
  },
  {
    sheet: "ABS Providers",
    group: "AgriBusiness Service Providers",
    description: "Laboratories, consultants and other service providers.",
    from: 3,
    map: serviceProviders,
  },
  {
    sheet: "Female Organizational Heads",
    group: "Female Organisational Heads",
    description: "Women leading partner organisations.",
    from: 3,
    map: serviceProviders,
  },
  {
    sheet: "TT Agri-Expo 2024 Form of Inter",
    group: "TT Agri-Expo 2024",
    description: "Expressions of interest from the 2024 Agri-Expo.",
    from: 3,
    map: (c) => ({
      name: c("A"),
      phone: c("B"),
      location: c("C"),
      organisation: c("E"),
      email: c("F"),
      notes: labelled([["Area of interest", c("D")], ["Other", c("G")]]),
    }),
  },
  {
    sheet: "Recognising Rural Leadership 4F",
    group: "Recognising Rural Leadership",
    description: "Participants in the rural leadership programme.",
    from: 3,
    map: (c) => ({
      name: c("A"),
      organisation: c("B"),
      phone: c("C"),
      email: c("D"),
      notes: c("E"),
    }),
  },
  {
    sheet: "PCR Stakeholders Meeting Regist",
    group: "PCR Stakeholders Meeting",
    description: "Registrations for the PCR stakeholders meeting.",
    from: 3,
    map: (c) => ({
      name: c("A"),
      phone: c("B"),
      email: c("C"),
      age_group: c("D"),
      gender: c("E"),
    }),
  },
];

function businessContacts(c) {
  return [
    {
      organisation: c("A"),
      name: c("B") ?? c("A"),
      phone: c("C"),
      email: c("D"),
      social: c("H"),
    },
    c("E") && {
      organisation: c("A"),
      name: c("E"),
      phone: c("F"),
      email: c("G"),
      social: c("H"),
      notes: "Secondary business contact",
    },
  ];
}

function serviceProviders(c) {
  return {
    organisation: c("A"),
    job_title: c("C"),
    name: c("D") ?? c("A"),
    phone: c("E"),
    email: c("F"),
    website: c("G"),
    notes: labelled([["Acronym", c("B")]]),
  };
}

const JUNK = new Set(["", "-", "--", "n/a", "na", "none", "tbd", "?", "."]);

function clean(value) {
  if (value == null) return null;
  let text = cellText(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (JUNK.has(text.toLowerCase())) return null;
  if (/^\d+\.0$/.test(text)) text = text.slice(0, -2);
  return text || null;
}

function join(...parts) {
  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text || null;
}

function labelled(pairs) {
  const parts = pairs.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  return parts.length ? parts.join("\n") : null;
}

function splitPair(value) {
  if (!value) return [null, null];
  const parts = value
    .split(/[/;]| or /i)
    .map((part) => part.trim())
    .filter(Boolean);
  return [parts[0] ?? null, parts.slice(1).join(", ") || null];
}

function mergeAlternates(explicitAlt, fromPrimary) {
  const tokens = [explicitAlt, fromPrimary]
    .filter(Boolean)
    .flatMap((v) => v.split(/[,;/]/).map((s) => s.trim()).filter(Boolean));
  const seen = new Set();
  const deduped = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(t);
    }
  }
  return deduped.join(", ") || null;
}

function normaliseGender(value) {
  if (!value) return null;
  const first = value.trim()[0]?.toUpperCase();
  if (first === "M") return "Male";
  if (first === "F") return "Female";
  return value;
}

function normaliseAge(value) {
  if (!value) return null;
  const text = value.replace(/\.0$/, "");
  return /^\d+$/.test(text) ? `${text}` : text;
}

function toRecord(raw) {
  const name = clean(raw.name);
  if (!name) return null;

  const [email, altFromEmail] = splitPair(clean(raw.email));
  const [phone, altFromPhone] = splitPair(clean(raw.phone));

  return {
    name,
    organisation: clean(raw.organisation),
    job_title: clean(raw.job_title),
    email,
    alt_email: mergeAlternates(clean(raw.alt_email), altFromEmail),
    phone,
    alt_phone: mergeAlternates(clean(raw.alt_phone), altFromPhone),
    location: clean(raw.location),
    gender: normaliseGender(clean(raw.gender)),
    age_group: normaliseAge(clean(raw.age_group)),
    website: clean(raw.website),
    social: clean(raw.social),
    notes: clean(raw.notes),
  };
}

loadEnvFiles();

const argv = process.argv.slice(2);
const replace = argv.includes("--replace");
const dryRun = argv.includes("--dry-run");
let skippedFile = null;
let workbookPath = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--skipped-file") {
    skippedFile = argv[++i] ?? null;
    if (!skippedFile) fail("--skipped-file requires a path");
  } else if (!argv[i].startsWith("-")) {
    workbookPath = argv[i];
  }
}

if (!workbookPath) {
  fail("Usage: node scripts/import-stakeholders.mjs [--replace] [--dry-run] [--skipped-file path] <workbook.xlsx>");
}
if (!fs.existsSync(workbookPath)) fail(`No such file: ${workbookPath}`);

const DATABASE_URL = resolveDatabaseUrl();
if (!DATABASE_URL) fail("DATABASE_URL is not set.");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);

const parsed = [];
const problems = [];
const skippedRows = [];

for (const config of SHEETS) {
  const ws = workbook.getWorksheet(config.sheet);
  if (!ws) {
    problems.push(`sheet not found: ${config.sheet}`);
    continue;
  }

  let kept = 0;
  const nameless = [];

  for (let rowNumber = config.from; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const cell = (letter) => clean(row.getCell(letter).value);

    const mapped = config.map(cell);
    for (const raw of Array.isArray(mapped) ? mapped.filter(Boolean) : [mapped]) {
      const record = toRecord(raw);
      if (record) {
        parsed.push({ ...record, group: config.group });
        kept++;
      } else {
        const contactHint =
          raw.email || raw.alt_email || raw.phone || raw.alt_phone || raw.organisation || raw.website;
        if (contactHint) {
          nameless.push(`${config.sheet} row ${rowNumber}: ${contactHint}`);
        }
      }
    }
  }

  const suffix = nameless.length ? `  (${nameless.length} row(s) with no name skipped)` : "";
  console.log(`  ${config.sheet.padEnd(34)} -> ${config.group.padEnd(32)} ${kept} contacts${suffix}`);
  skippedRows.push(...nameless);
}

const seen = new Set();
const records = parsed.filter((r) => {
  const key = r.email
    ? `${r.group}|${r.name.toLowerCase()}|${r.email.toLowerCase()}`
    : `${r.group}|${r.name.toLowerCase()}|${(r.phone ?? "").toLowerCase()}|${(r.organisation ?? "").toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`\nParsed ${parsed.length} rows, ${records.length} after removing duplicates.`);
if (problems.length) console.log(`Warnings:\n  ${problems.join("\n  ")}`);

if (skippedRows.length) {
  const outTarget = skippedFile ?? path.join(os.tmpdir(), "iica-skipped-stakeholder-rows.txt");
  fs.writeFileSync(outTarget, `${skippedRows.join("\n")}\n`, { mode: 0o600 });
  console.log(
    `\n${skippedRows.length} row(s) had contact details but no name and were not imported.` +
      `\nThe full list is in ${outTarget} - add the missing names to the workbook and re-run.`,
  );
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

const sql = createScriptSql(DATABASE_URL);

try {
  let inserted = 0;
  let skipped = 0;
  const groupIds = new Map();

  await sql.begin(async (tx) => {
    if (replace) {
      await tx`DELETE FROM stakeholders`;
      console.log("Cleared the existing directory (--replace).");
    }

    for (const config of SHEETS) {
      const [existingGroup] = await tx`
        SELECT id FROM stakeholder_groups WHERE lower(name) = lower(${config.group}) LIMIT 1`;
      if (existingGroup) {
        await tx`
          UPDATE stakeholder_groups SET description = ${config.description} WHERE id = ${existingGroup.id}`;
        groupIds.set(config.group, existingGroup.id);
      } else {
        const [row] = await tx`
          INSERT INTO stakeholder_groups (name, description)
          VALUES (${config.group}, ${config.description})
          ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
          RETURNING id`;
        groupIds.set(config.group, row.id);
      }
    }

    for (const record of records) {
      const groupId = groupIds.get(record.group);

      if (!replace) {
        const [existing] = record.email
          ? await tx`
              SELECT id FROM stakeholders
               WHERE lower(name) = ${record.name.toLowerCase()}
                 AND COALESCE(lower(email), '') = ${record.email.toLowerCase()}
                 AND group_id IS NOT DISTINCT FROM ${groupId}
               LIMIT 1`
          : await tx`
              SELECT id FROM stakeholders
               WHERE lower(name) = ${record.name.toLowerCase()}
                 AND (email IS NULL OR email = '')
                 AND COALESCE(lower(phone), '') = ${(record.phone ?? "").toLowerCase()}
                 AND COALESCE(lower(organisation), '') = ${(record.organisation ?? "").toLowerCase()}
                 AND group_id IS NOT DISTINCT FROM ${groupId}
               LIMIT 1`;
        if (existing) {
          skipped++;
          continue;
        }
      }

      await tx`
        INSERT INTO stakeholders ${tx(
          { ...record, group_id: groupId, group: undefined },
          "name",
          "organisation",
          "job_title",
          "email",
          "alt_email",
          "phone",
          "alt_phone",
          "location",
          "gender",
          "age_group",
          "website",
          "social",
          "notes",
          "group_id",
        )}`;
      inserted++;
    }

    await tx`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (NULL, 'system (import-stakeholders script)', 'IMPORT', 'stakeholder', NULL,
              ${`${path.basename(workbookPath)}: ${inserted} inserted, ${skipped} unchanged${replace ? " (--replace)" : ""}`})`;
  });

  console.log(`\nInserted ${inserted} contacts across ${groupIds.size} groups.`);
  if (skipped) console.log(`${skipped} already in the directory and left unchanged.`);
} catch (error) {
  console.error("Stakeholder import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
