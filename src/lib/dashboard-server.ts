import "server-only";
import { sql } from "@/lib/db";
import { DEFAULT_LAYOUT, parseLayout, type DashboardLayout } from "@/lib/dashboard";

/**
 * Server-only loader for a user's saved dashboard layout.
 * Kept out of `"use server"` action modules so it is never exposed as a
 * publicly callable Server Action.
 */
export async function loadLayout(userId: number): Promise<DashboardLayout> {
  const [row] = await sql<{ layout: string }[]>`
    SELECT layout FROM dashboard_layouts WHERE user_id = ${userId}`;
  return row ? parseLayout(row.layout) : DEFAULT_LAYOUT;
}
