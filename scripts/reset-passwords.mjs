#!/usr/bin/env node
/**
 * Issues every account a fresh temporary password and forces a change on next
 * sign-in. Writes passwords atomically to a 0600 file inside the transaction so
 * a write error rolls back all DB password changes.
 *
 * Usage:
 *   node scripts/reset-passwords.mjs "<connection string>" <output file> [--yes]
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { createScriptSql, fail, hashPassword } from "./_lib.mjs";

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

const [, , target, outPath, flag] = process.argv;
if (!target || !outPath) {
  fail("Usage: node scripts/reset-passwords.mjs <connection string> <output file> [--yes]");
}
if (target.includes("localhost") || target.includes("127.0.0.1")) {
  fail("Refusing to run: that looks like the local database, not the hosted one.");
}

const sql = createScriptSql(target);

try {
  const users = await sql`SELECT id, name, email, role FROM users ORDER BY id`;
  if (!users.length) {
    console.error("No accounts found.");
    process.exitCode = 1;
  } else if (flag !== "--yes") {
    console.log(`Would reset ${users.length} accounts. Re-run with --yes to apply.`);
  } else {
    const issued = [];
    await sql.begin(async (tx) => {
      for (const user of users) {
        const password = generatePassword();
        await tx`
          UPDATE users
             SET password_hash = ${await hashPassword(password)},
                 must_change_password = true,
                 token_version = token_version + 1
           WHERE id = ${user.id}`;
        issued.push({ ...user, password });
      }

      await tx`
        INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
        VALUES (NULL, 'system (reset-passwords script)', 'RESET_PASSWORD', 'user', NULL,
                ${`Bulk password reset issued for ${issued.length} account(s)`})`;

      const resolvedOut = path.resolve(outPath);
      const dir = path.dirname(resolvedOut);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = path.join(dir, `.reset-passwords.${process.pid}.tmp`);

      const lines = [
        "IICA-TT Internal System - temporary passwords",
        `Issued ${new Date().toISOString()}`,
        "",
        "Every account must set its own password at first sign-in.",
        "Hand these out individually, then delete this file.",
        "",
        ...issued.map(
          (u) => `${(u.email ?? "").padEnd(38)} ${String(u.role).padEnd(8)} ${u.password}`,
        ),
        "",
      ];
      fs.writeFileSync(tmpPath, lines.join("\n"), { mode: 0o600 });
      fs.chmodSync(tmpPath, 0o600);
      fs.renameSync(tmpPath, resolvedOut);
    });

    console.log(`Reset ${issued.length} accounts.`);
    console.log(`Passwords written to ${outPath} (owner-read only).`);
  }
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
