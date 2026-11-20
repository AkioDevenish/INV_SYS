"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseLayout, type DashboardLayout } from "@/lib/dashboard";

export type LayoutState = { error?: string; ok?: boolean };

/**
 * Saves one person's arrangement. Parsed through the same validator used on
 * read, so a malformed payload cannot put unknown ids into the database.
 */
export async function saveLayoutAction(layout: DashboardLayout): Promise<LayoutState> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "You are not signed in." };
    if (user.mustChangePassword) return { error: "Please change your password before continuing." };
    if (!layout || typeof layout !== "object") {
      return { error: "Invalid layout data." };
    }

    const clean = parseLayout(JSON.stringify(layout));

    await sql`
      INSERT INTO dashboard_layouts (user_id, layout, updated_at)
      VALUES (${user.userId}, ${JSON.stringify(clean)}, now())
      ON CONFLICT (user_id)
      DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`;

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    console.error("saveLayoutAction failed:", error);
    return { error: "Could not save the layout. Please try again." };
  }
}

/** Back to the arrangement everyone starts from. */
export async function resetLayoutAction(): Promise<LayoutState> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "You are not signed in." };
    if (user.mustChangePassword) return { error: "Please change your password before continuing." };

    await sql`DELETE FROM dashboard_layouts WHERE user_id = ${user.userId}`;
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    console.error("resetLayoutAction failed:", error);
    return { error: "Could not reset the layout. Please try again." };
  }
}
