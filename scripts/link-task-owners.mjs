#!/usr/bin/env node
/**
 * Links tasks to active accounts by matching the sheet's initials (or full name)
 * against staff names.
 *
 * Usage: node scripts/link-task-owners.mjs ["<connection string | --env>"] [--yes]
 */
import {
  INITIALS_ALIASES,
  createScriptSql,
  fail,
  loadEnvFiles,
  resolveDatabaseUrl,
} from "./_lib.mjs";

const NOT_PEOPLE = new Set(["TEAM", "ALL", "SPECIAL"]);

loadEnvFiles();

const args = process.argv.slice(2);
const apply = args.includes("--yes");
const rawTarget = args.find((a) => !a.startsWith("-"));
const target = rawTarget && rawTarget !== "--env" ? rawTarget : resolveDatabaseUrl();
if (!target) {
  fail('Usage: node scripts/link-task-owners.mjs ["<connection string>"] [--yes]');
}

const sql = createScriptSql(target);

try {
  const users = await sql`SELECT id, name FROM users WHERE status = 'ACTIVE' ORDER BY id`;
  const byInitials = new Map();
  const ambiguous = new Set();
  const byFullName = new Map();

  for (const user of users) {
    byFullName.set(user.name.trim().toLowerCase(), user);
    const initials = user.name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join("");
    if (!initials) continue;
    if (byInitials.has(initials)) {
      ambiguous.add(initials);
    } else {
      byInitials.set(initials, user);
    }
  }
  for (const ini of ambiguous) {
    byInitials.delete(ini);
  }
  for (const [initials, fullName] of Object.entries(INITIALS_ALIASES)) {
    const match = users.find((u) => u.name.toLowerCase() === fullName.toLowerCase());
    if (match) byInitials.set(initials.toUpperCase(), match);
  }

  const tasks = await sql`
    SELECT id, lead FROM staff_tasks WHERE owner_id IS NULL AND lead IS NOT NULL`;
  const plan = [];
  const unmatched = new Map();

  for (const task of tasks) {
    const tokens = task.lead
      .split(/[/,&+\-]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const personTokens = tokens.filter((t) => !NOT_PEOPLE.has(t.toUpperCase()));
    if (!personTokens.length) continue;

    let resolved = null;
    for (const token of personTokens) {
      resolved =
        byInitials.get(token.toUpperCase()) ?? byFullName.get(token.toLowerCase()) ?? null;
      if (resolved) break;
    }

    if (resolved) {
      plan.push({ id: task.id, userId: resolved.id, initials: personTokens[0], name: resolved.name });
    } else {
      const key = personTokens[0].toUpperCase();
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
    }
  }

  const summary = new Map();
  for (const p of plan) summary.set(p.name, (summary.get(p.name) ?? 0) + 1);

  console.log(`Would assign ${plan.length} of ${tasks.length} unassigned tasks:`);
  [...summary.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n]) => console.log(`  ${String(n).padStart(3)}  ${name}`));
  if (unmatched.size) {
    console.log("No unambiguous active account matches these leads, left unassigned:");
    [...unmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([ini, n]) => console.log(`  ${String(n).padStart(3)}  ${ini}`));
  }

  if (!apply) {
    console.log("\nRe-run with --yes to apply.");
  } else if (plan.length > 0) {
    await sql.begin(async (tx) => {
      for (const p of plan) {
        await tx`
          UPDATE staff_tasks
             SET owner_id = ${p.userId},
                 updated_at = now()
           WHERE id = ${p.id}`;
      }
      await tx`
        INSERT INTO audit_logs (user_id, user_label, action, entity, entity_id, details)
        VALUES (NULL, 'system (link-task-owners script)', 'UPDATE', 'staff_task', NULL,
                ${`Linked ${plan.length} timeline task owner(s)`})`;
    });
    console.log(`\nAssigned ${plan.length} tasks.`);
  }
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
