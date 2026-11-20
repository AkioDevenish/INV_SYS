#!/usr/bin/env node
/**
 * Creates user accounts in bulk inside a single transaction and prints a
 * one-time password for each newly created account.
 *
 *   node scripts/add-users.mjs a.person@iica.int b.person@iica.int
 *   node scripts/add-users.mjs --role MANAGER a.person@iica.int
 *   node scripts/add-users.mjs --role ADMIN --file roster.txt
 */
import fs from "node:fs";
import { randomInt } from "node:crypto";
import {
  createScriptSql,
  fail,
  hashPassword,
  loadEnvFiles,
  resolveDatabaseUrl,
} from "./_lib.mjs";

const ROLES = new Set(["ADMIN", "MANAGER", "STAFF", "VIEWER"]);
const NAME_SUFFIXES = new Set(["consultant", "contractor", "temp", "intern", "admin"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const emails = [];
  let role = "STAFF";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--role") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) fail("--role needs a value");
      role = next.toUpperCase();
      if (!ROLES.has(role)) fail(`--role must be one of ${[...ROLES].join(", ")}`);
    } else if (arg === "--file") {
      const file = argv[++i];
      if (!file) fail("--file needs a path");
      if (!fs.existsSync(file)) fail(`No such file: ${file}`);
      emails.push(
        ...fs
          .readFileSync(file, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      );
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}`);
    } else {
      emails.push(arg);
    }
  }
  return { emails, role };
}

/** "veronica.alleyne-bailey@iica.int" -> "Veronica Alleyne-Bailey" */
function nameFromEmail(email) {
  const local = email.split("@")[0] ?? "";
  const rawParts = local.split(".").filter(Boolean);
  const filtered = rawParts.filter((part) => !NAME_SUFFIXES.has(part.toLowerCase()));
  const parts = filtered.length > 0 ? filtered : rawParts;

  const formatted = parts
    .map((part) =>
      part
        .split("-")
        .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase())
        .join("-"),
    )
    .join(" ")
    .trim();

  return formatted || local || "User";
}

function generatePassword() {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;

  const chars = [
    letters[randomInt(letters.length)],
    digits[randomInt(digits.length)],
    ...Array.from({ length: 12 }, () => all[randomInt(all.length)]),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

loadEnvFiles();

const { emails: rawEmails, role } = parseArgs(process.argv.slice(2));
if (rawEmails.length === 0) {
  fail("Usage: node scripts/add-users.mjs [--role ROLE] [--file roster.txt] email…");
}

const emails = [];
const seenEmails = new Set();
for (const raw of rawEmails) {
  const normalised = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(normalised)) fail(`Invalid email address: ${raw}`);
  if (!seenEmails.has(normalised)) {
    seenEmails.add(normalised);
    emails.push(normalised);
  }
}

const DATABASE_URL = resolveDatabaseUrl();
if (!DATABASE_URL) fail("DATABASE_URL is not set.");

const sql = createScriptSql(DATABASE_URL);

try {
  const created = [];
  let skipped = 0;

  await sql.begin(async (tx) => {
    for (const normalised of emails) {
      const [existing] = await tx`SELECT id, role FROM users WHERE lower(email) = ${normalised}`;
      if (existing) {
        console.log(`- ${normalised} already exists (${existing.role}) - left unchanged`);
        skipped++;
        continue;
      }

      const name = nameFromEmail(normalised);
      const password = generatePassword();
      const [row] = await tx`
        INSERT INTO users (name, email, password_hash, role, status, must_change_password)
        VALUES (${name}, ${normalised}, ${await hashPassword(password)}, ${role}, 'ACTIVE', true)
        RETURNING id`;

      await tx`
        INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
        VALUES (NULL, 'system (add-users script)', 'CREATE', 'user', ${String(row.id)},
                ${`Account created for ${normalised} as ${role}`})`;

      created.push({ name, email: normalised, role, password });
    }
  });

  if (created.length > 0) {
    const width = Math.max(...created.map((u) => u.email.length));
    console.log(`\nCreated ${created.length} account${created.length === 1 ? "" : "s"} (${role}):\n`);
    for (const u of created) {
      console.log(`  ${u.email.padEnd(width)}  ${u.password}  ${u.name}`);
    }
    console.log("\nThese passwords are shown once and are not stored anywhere.");
    console.log("They are temporary: each person is required to choose their own");
    console.log("password the first time they sign in.");
  }
  if (skipped > 0) console.log(`\n${skipped} account(s) already existed and were skipped.`);
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
