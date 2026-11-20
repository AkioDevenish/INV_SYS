import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
export const MAX_PASSWORD_LENGTH = 256;

const DEFAULT_SCRYPT_N = 32768;
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;
const MAX_SCRYPT_MEM = 64 * 1024 * 1024;

// Constant dummy hash used to equalize login timing when an email is unknown.
const DUMMY_SALT = Buffer.from("00112233445566778899aabbccddeeff", "hex");

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options?: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cb = (error: Error | null, derivedKey: Buffer) => {
      if (error) reject(error);
      else resolve(derivedKey);
    };
    if (options) scrypt(password, salt, keylen, options, cb);
    else scrypt(password, salt, keylen, cb);
  });
}

function isHex(value: string, expectedBytes?: number): boolean {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return false;
  return expectedBytes === undefined ? true : value.length === expectedBytes * 2;
}

/**
 * Stored as `scrypt$<N>:<r>:<p>$<salt-hex>$<hash-hex>` so work factors are explicit
 * while remaining backward-compatible with legacy `scrypt$<salt-hex>$<hash-hex>` hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: DEFAULT_SCRYPT_N,
    r: DEFAULT_SCRYPT_R,
    p: DEFAULT_SCRYPT_P,
    maxmem: MAX_SCRYPT_MEM,
  });
  return `scrypt$${DEFAULT_SCRYPT_N}:${DEFAULT_SCRYPT_R}:${DEFAULT_SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;

  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return false;

  let saltHex: string | undefined;
  let hashHex: string | undefined;
  let options: ScryptOptions | undefined;

  if (parts.length === 3) {
    [, saltHex, hashHex] = parts;
  } else if (parts.length === 4) {
    const [, params, sHex, hHex] = parts;
    const match = params?.match(/^(\d+):(\d+):(\d+)$/);
    if (!match) return false;
    const N = Number(match[1]);
    const r = Number(match[2]);
    const p = Number(match[3]);
    if (!Number.isInteger(N) || N < 1024 || N > 131072 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
      return false;
    }
    saltHex = sHex;
    hashHex = hHex;
    options = { N, r, p, maxmem: MAX_SCRYPT_MEM };
  } else {
    return false;
  }

  if (!saltHex || !hashHex || !isHex(saltHex) || !isHex(hashHex, KEY_LENGTH)) return false;

  const expected = Buffer.from(hashHex, "hex");
  try {
    const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), KEY_LENGTH, options);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    // Reject malformed / over-maxmem stored hashes safely instead of throwing a 500.
    return false;
  }
}

/**
 * True when a stored hash uses the legacy 3-part format or weaker scrypt work
 * factors than the current default (`N=32768, r=8, p=1`), so callers can
 * transparently upgrade the hash after a successful sign-in.
 */
export function needsPasswordRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return true;
  if (parts.length === 3) return true;
  if (parts.length !== 4) return true;
  const match = parts[1]?.match(/^(\d+):(\d+):(\d+)$/);
  if (!match) return true;
  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  return N < DEFAULT_SCRYPT_N || r !== DEFAULT_SCRYPT_R || p !== DEFAULT_SCRYPT_P;
}

/** Runs an equivalent scrypt derivation when an account does not exist to prevent user-enumeration timing leaks. */
export async function verifyDummyPassword(password: string): Promise<void> {
  if (!password || password.length > MAX_PASSWORD_LENGTH) return;
  await scryptAsync(password, DUMMY_SALT, KEY_LENGTH, {
    N: DEFAULT_SCRYPT_N,
    r: DEFAULT_SCRYPT_R,
    p: DEFAULT_SCRYPT_P,
    maxmem: MAX_SCRYPT_MEM,
  });
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters long.";
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }
  if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  return null;
}
