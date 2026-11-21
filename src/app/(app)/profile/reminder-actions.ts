"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { assertPermission, assertSignedIn, recordAudit } from "@/lib/auth";
import { sendWeeklyReminders } from "@/lib/reminders";

export type ReminderState = { ok?: boolean; error?: string; message?: string };

export async function setRemindersEnabledAction(enabled: boolean): Promise<ReminderState> {
  try {
    const user = await assertSignedIn();
    await sql`UPDATE users SET reminders_enabled = ${enabled} WHERE id = ${user.userId}`;
    await recordAudit({
      user,
      action: "UPDATE",
      entity: "profile",
      entityId: user.userId,
      details: `Weekly reminder emails turned ${enabled ? "on" : "off"}`,
    });
    revalidatePath("/profile");
    return { ok: true };
  } catch {
    return { error: "That setting couldn't be saved." };
  }
}

/** Sends the signed-in person their own digest now, whatever the weekly guard says. */
export async function sendTestReminderAction(): Promise<ReminderState> {
  try {
    const user = await assertSignedIn();
    const run = await sendWeeklyReminders({ force: true, onlyUserId: user.userId });
    if (run.notConfigured) return { error: "Email isn't set up on the server yet." };
    if (run.failed.length) return { error: run.failed[0].error };
    if (run.nothingDue) return { message: "Nothing is overdue or due in the next 7 days, so there's nothing to send." };
    return { ok: true, message: `Sent to ${user.email}.` };
  } catch {
    return { error: "The test email couldn't be sent." };
  }
}

/** Administrators can run this week's reminders by hand; the weekly guard still applies. */
export async function sendAllRemindersAction(): Promise<ReminderState> {
  try {
    const user = await assertPermission("users.manage");
    const run = await sendWeeklyReminders();
    if (run.notConfigured) return { error: "Email isn't set up on the server yet." };
    await recordAudit({
      user,
      action: "REMINDERS",
      entity: "system",
      details: `Weekly reminders sent by hand: ${run.sent} sent, ${run.nothingDue} with nothing due, ${run.skippedRecent} already sent this week, ${run.failed.length} failed`,
    });
    const parts = [
      `${run.sent} sent`,
      run.skippedRecent ? `${run.skippedRecent} already had this week's` : null,
      run.nothingDue ? `${run.nothingDue} had nothing due` : null,
      run.failed.length ? `${run.failed.length} failed` : null,
    ].filter(Boolean);
    return run.failed.length && !run.sent
      ? { error: `${parts.join(", ")}. First error: ${run.failed[0].error}` }
      : { ok: true, message: `${parts.join(", ")}.` };
  } catch {
    return { error: "Reminders couldn't be sent." };
  }
}
