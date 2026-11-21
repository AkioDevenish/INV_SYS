#!/usr/bin/env node
/**
 * Exports timelines as a workbook shaped for a Microsoft List.
 *
 * Usage: node scripts/export-timelines-for-lists.mjs "<connection string>" <out.xlsx>
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { createScriptSql, fail, loadEnvFiles, resolveDatabaseUrl } from "./_lib.mjs";

loadEnvFiles();

const [, , argTarget, argOutPath] = process.argv;
const target = argTarget === "--env" ? resolveDatabaseUrl() : argTarget;
const outPath = argOutPath;
if (!target || !outPath) {
  fail('Usage: node scripts/export-timelines-for-lists.mjs "<connection string | --env>" <out.xlsx>');
}

const AREA = {
  TC: "Technical cooperation",
  ADMIN: "Administration",
  DF: "Personal list (DF)",
};
const PRIORITY = { H: "High", M: "Medium", L: "Low" };
const STATUS = {
  NOT_STARTED: "Not started",
  ONGOING: "Ongoing",
  DELAYED: "Delayed",
  COMPLETE: "Complete",
};

/** Leads that name a group, so an empty Assigned To is expected rather than a gap. */
const GROUP_LEADS = new Set(["TEAM", "ALL", "SPECIAL"]);

const HEADERS = [
  "Title",
  "Area",
  "Lead",
  "Assigned To",
  "Origin",
  "Priority",
  "Status",
  "% Complete",
  "Start date",
  "Due date",
  "Schedule note",
  "Comments",
  "What is left to do",
  "Data check",
];

const utcDate = (d) =>
  d instanceof Date ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null;

const NOW = new Date();
const EARLIEST = new Date(Date.UTC(NOW.getUTCFullYear() - 1, NOW.getUTCMonth(), NOW.getUTCDate()));
const LATEST = new Date(Date.UTC(NOW.getUTCFullYear() + 3, NOW.getUTCMonth(), NOW.getUTCDate()));
const plausible = (d) => d && d >= EARLIEST && d <= LATEST;
const iso = (d) => d.toISOString().slice(0, 10);

const safeExcelText = (value) => {
  if (value == null) return null;
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

/**
 * Complete means 100% and Not started means 0% regardless of stale progress figures.
 * Ongoing/Delayed tasks keep their explicit progress or stay blank if unset.
 */
function percentFor(t) {
  if (t.status === "COMPLETE") return 1;
  if (t.status === "NOT_STARTED") return 0;
  if (t.progress !== null) return Math.max(0, Math.min(1, t.progress / 100));
  return null;
}

const sql = createScriptSql(target);

try {
  const tasks = await sql`
    SELECT t.*, o.email AS owner_email
      FROM staff_tasks t
      LEFT JOIN users o ON o.id = t.owner_id
     ORDER BY t.area, COALESCE(t.starts_on, t.ends_on) NULLS LAST, t.position NULLS LAST, t.id`;

  const rows = [];
  const flagged = [];

  for (const t of tasks) {
    const checks = [];
    let start = utcDate(t.starts_on);
    let due = utcDate(t.ends_on);

    if (start && !plausible(start)) {
      checks.push(`Source start date ${iso(start)} looks wrong, left blank`);
      start = null;
    }
    if (due && !plausible(due)) {
      checks.push(`Source due date ${iso(due)} looks wrong, left blank`);
      due = null;
    }

    const lead = (t.lead ?? "").trim();
    const firstLead = lead.split(/[/,&+\-]+/)[0].trim().toUpperCase();
    if (!t.owner_email) {
      if (!lead) {
        checks.push("No lead or owner assigned");
      } else {
        checks.push(
          GROUP_LEADS.has(firstLead)
            ? `Lead is "${lead}", a group. Assign a person if one should own it`
            : `No account for lead "${lead}". Assign a person`,
        );
      }
    }

    if (checks.length) flagged.push({ title: t.title, checks });

    rows.push([
      safeExcelText(t.title),
      safeExcelText(AREA[String(t.area).toUpperCase()] ?? t.area),
      safeExcelText(lead || null),
      safeExcelText(t.owner_email ?? null),
      safeExcelText(t.origin ?? null),
      PRIORITY[t.priority] ?? null,
      STATUS[t.status] ?? "Not started",
      percentFor(t),
      start,
      due,
      safeExcelText(t.schedule_note ?? null),
      safeExcelText(t.comments ?? null),
      safeExcelText(t.progress_note ?? null),
      safeExcelText(checks.join("; ") || null),
    ]);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tasks");

  if (rows.length > 0) {
    ws.addTable({
      name: "StaffTimelines",
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: HEADERS.map((name) => ({ name })),
      rows,
    });
  } else {
    // OOXML tables with 0 data rows trigger Excel repair prompts, so emit a
    // styled header row instead when staff_tasks is empty.
    const head = ws.addRow(HEADERS);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14477D" } };
  }

  const widths = [52, 22, 12, 32, 18, 10, 13, 12, 12, 12, 26, 44, 40, 48];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(8).numFmt = "0%";
  ws.getColumn(9).numFmt = "yyyy-mm-dd";
  ws.getColumn(10).numFmt = "yyyy-mm-dd";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const guide = wb.addWorksheet("Read me");
  guide.getColumn(1).width = 110;
  [
    "IICA-TT Timelines, prepared for a Microsoft List",
    "",
    `${rows.length} tasks exported ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "1. Create the list first, with the columns in the setup guide (names and types must match).",
    "2. Open the list, switch to Edit in grid view, select the first empty Title cell.",
    "3. Copy the data rows from the Tasks sheet (not the header) and paste them in.",
    "4. Assigned To holds email addresses so the Person column resolves them on paste.",
    "5. % Complete is stored as a fraction and shown as a percentage. Leave the column type as Number, shown as percentage.",
    "   Complete tasks are 100% and Not started tasks are 0%. Ongoing tasks with no figure are blank on purpose.",
    "6. Dates more than a year old (or 3+ years ahead) are blanked and the original is kept in Data check.",
    "",
    "Check the Data check column before pasting. Those rows need a decision from a person:",
    `${flagged.length} of ${rows.length} rows carry a note.`,
  ].forEach((line, i) => (guide.getCell(i + 1, 1).value = line));
  guide.getCell(1, 1).font = { bold: true, size: 13 };

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  const by = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
  console.log(`Wrote ${rows.length} tasks to ${outPath}`);
  console.log("By area:", JSON.stringify(by(1)));
  console.log("With an assigned person:", rows.filter((r) => r[3]).length);
  console.log("Rows flagged in Data check:", flagged.length);
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
