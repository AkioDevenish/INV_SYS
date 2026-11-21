import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const password = loadTs("src/lib/password.ts");
const session = loadTs("src/lib/session.ts");
const auth = loadTs("src/lib/auth.ts");
const permissions = loadTs("src/lib/permissions.ts");
const roles = loadTs("src/lib/roles.ts");
const format = loadTs("src/lib/format.ts");

describe("password.ts", () => {
  it("enforces password length and complexity rules", () => {
    assert.match(password.passwordProblem("short1") ?? "", /at least 8/);
    assert.match(password.passwordProblem("12345678") ?? "", /at least one letter/);
    assert.match(password.passwordProblem("abcdefgh") ?? "", /at least one number/);
    assert.match(
      password.passwordProblem("a1".repeat(130)) ?? "",
      new RegExp(`${password.MAX_PASSWORD_LENGTH} characters`),
    );
    assert.equal(password.passwordProblem("ValidPass1"), null);
  });

  it("hashes and verifies passwords in N:r:p scrypt format and legacy 3-part format", async () => {
    const hash = await password.hashPassword("Trinidad2026!");
    assert.match(hash, /^scrypt\$32768:8:1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await password.verifyPassword("Trinidad2026!", hash), true);
    assert.equal(await password.verifyPassword("WrongPass1!", hash), false);
    assert.equal(await password.verifyPassword("", hash), false);
    assert.equal(await password.verifyPassword("a".repeat(257), hash), false);

    // Rejects malformed / out-of-range scrypt work parameters
    const parts = hash.split("$");
    assert.equal(await password.verifyPassword("Trinidad2026!", `scrypt$16:8:1$${parts[2]}$${parts[3]}`), false);
    assert.equal(await password.verifyPassword("Trinidad2026!", "plain$salt$hash"), false);
  });
});

describe("session.ts", () => {
  it("signs and verifies session JWTs and rejects tampered or invalid claims", async () => {
    const token = await session.signSession({
      userId: 7,
      name: "Admin User",
      email: "admin@iica.int",
      role: "ADMIN",
      ver: 2,
    });

    const parsed = await session.readSession(token);
    assert.deepEqual(parsed, {
      userId: 7,
      name: "Admin User",
      email: "admin@iica.int",
      role: "ADMIN",
      ver: 2,
    });

    const [h, p, sig] = token.split(".");
    const tampered = `${h}.${p}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    assert.equal(await session.readSession(tampered), null);
    assert.equal(await session.readSession(undefined), null);
  });
});

describe("auth.ts sanitizeNextPath", () => {
  it("allows safe internal routes and blocks open redirects or auth/api paths", () => {
    assert.equal(auth.sanitizeNextPath("/inventory?page=2&q=desk"), "/inventory?page=2&q=desk");
    assert.equal(auth.sanitizeNextPath("/vendors"), "/vendors");
    assert.equal(auth.sanitizeNextPath("//evil.com/phish"), null);
    assert.equal(auth.sanitizeNextPath("/\\evil.com"), null);
    assert.equal(auth.sanitizeNextPath("https://evil.com"), null);
    assert.equal(auth.sanitizeNextPath("/inventory\nSet-Cookie: a=1"), null);
    assert.equal(auth.sanitizeNextPath("/login"), null);
    assert.equal(auth.sanitizeNextPath("/setup"), null);
    assert.equal(auth.sanitizeNextPath("/change-password"), null);
    assert.equal(auth.sanitizeNextPath("/api/export"), null);
    assert.equal(auth.sanitizeNextPath(`/${"a".repeat(520)}`), null);
  });
});

describe("permissions.ts defaultHomeForRole", () => {
  it("routes each role to its first allowed nav entry and falls back to /profile", () => {
    assert.equal(permissions.defaultHomeForRole(roles.DEFAULT_ROLE_PERMISSIONS, "ADMIN"), "/dashboard");

    const customMatrix = {
      ...roles.DEFAULT_ROLE_PERMISSIONS,
      VIEWER: ["stakeholders.view"],
      STAFF: [],
    };
    assert.equal(permissions.defaultHomeForRole(customMatrix, "VIEWER"), "/stakeholders");
    assert.equal(permissions.defaultHomeForRole(customMatrix, "STAFF"), "/profile");
    assert.equal(permissions.defaultHomeForRole(customMatrix, null), "/profile");
  });
});

describe("format.ts", () => {
  it("formats dates in America/Port_of_Spain (AST, UTC-4) without midnight day drift", () => {
    assert.equal(format.APP_TIMEZONE, "America/Port_of_Spain");
    assert.equal(format.formatDate("2026-05-01"), "01 May 2026");
    // 2026-05-01T02:00:00Z is 2026-04-30 22:00 AST
    assert.equal(format.formatDate("2026-05-01T02:00:00Z"), "30 Apr 2026");
    assert.equal(format.formatDate(null), "-");
    assert.equal(format.formatDateTime(null), "-");
  });

  it("pluralizes units cleanly", () => {
    assert.equal(format.formatUnits(1, "box"), "1 box");
    assert.equal(format.formatUnits(3, "box"), "3 boxes");
    assert.equal(format.formatUnits(2, "batch"), "2 batches");
    assert.equal(format.formatUnits(5, "ream"), "5 reams");
  });
});
