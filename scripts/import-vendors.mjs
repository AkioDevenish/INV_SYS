#!/usr/bin/env node
/**
 * Imports vendors from an Excel workbook into the `vendors` table.
 *
 * Usage: node scripts/import-vendors.mjs <vendors.xlsx>
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { cellText, createScriptSql, fail, loadEnvFiles, resolveDatabaseUrl } from "./_lib.mjs";

loadEnvFiles();

const file = process.argv[2];
if (!file) fail("Usage: node scripts/import-vendors.mjs <vendors.xlsx>");
if (!fs.existsSync(file)) fail(`No such file: ${file}`);

const DATABASE_URL = resolveDatabaseUrl();
if (!DATABASE_URL) fail("DATABASE_URL is not set.");

const SUMMARY_LABEL_RE = /^(?:total|grand\s+total|sub-?total|notes?|summary)\b[:\s-]?/i;

const clean = (value) => cellText(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const sheet = workbook.worksheets[0];
if (!sheet) fail("Workbook contains no worksheets.");

const db = createScriptSql(DATABASE_URL);

try {
  let category = "Other";
  let added = 0;
  let skipped = 0;

  await db.begin(async (tx) => {
    for (let row = 3; row <= sheet.rowCount; row++) {
      const r = sheet.getRow(row);
      const a = clean(r.getCell(1).value);
      const service = clean(r.getCell(2).value);
      const name = clean(r.getCell(3).value);
      const phone = clean(r.getCell(4).value);
      const contact = clean(r.getCell(5).value);
      const email = clean(r.getCell(6).value);

      if (a && !service && !name && !phone && !contact && !email) {
        if (!SUMMARY_LABEL_RE.test(a)) category = a;
        continue;
      }
      if (!name) continue;

      const exists = await tx`
        SELECT 1 FROM vendors
         WHERE lower(name) = lower(${name})
           AND lower(category) = lower(${category})
         LIMIT 1`;
      if (exists.length) {
        skipped++;
        continue;
      }

      await tx`
        INSERT INTO vendors (category, service, name, phone, contact_person, email)
        VALUES (${category}, ${service || null}, ${name}, ${phone || null}, ${contact || null}, ${email || null})`;
      added++;
    }

    await tx`
      INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
      VALUES (NULL, 'system (import-vendors script)', 'IMPORT', 'vendor', NULL,
              ${`${path.basename(file)}: ${added} added, ${skipped} already present`})`;
  });

  console.log(`Imported ${added} vendors (${skipped} skipped).`);
} catch (error) {
  console.error("Vendor import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
