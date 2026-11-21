import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    await sql`SELECT 1 AS ok`;
    return NextResponse.json(
      { status: "ok", database: "connected", timestamp },
      { status: 200, headers: HEADERS },
    );
  } catch (error) {
    console.error("Health check failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp },
      { status: 503, headers: HEADERS },
    );
  }
}
