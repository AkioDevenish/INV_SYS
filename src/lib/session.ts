import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role } from "./roles";

export const SESSION_COOKIE = "iica_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  userId: number;
  name: string;
  email: string;
  role: Role;
  ver: number;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32) {
      throw new Error(
        "AUTH_SECRET is missing or too short. Set it to a random string of at least 32 characters.",
      );
    }
    return new TextEncoder().encode(secret);
  }
  if (!secret || secret.length < 16) {
    return new TextEncoder().encode("iica-development-secret-do-not-use-in-production");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    ver: payload.ver,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId !== "number" ||
      !Number.isInteger(payload.userId) ||
      payload.userId <= 0 ||
      typeof payload.role !== "string" ||
      !isRole(payload.role) ||
      typeof payload.ver !== "number" ||
      !Number.isInteger(payload.ver) ||
      payload.ver < 1
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      role: payload.role,
      ver: payload.ver,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
