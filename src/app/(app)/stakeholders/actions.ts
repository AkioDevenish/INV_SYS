"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { assertPermission, recordAudit } from "@/lib/auth";

export type StakeholderState = { error?: string; ok?: boolean };

/** Empty strings become NULL so "no email" is one value, not two. */
function text(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

function normalizeWebsite(raw: string | null): { value: string | null } | { error: string } {
  if (!raw) return { value: null };
  if (raw.startsWith("//")) {
    return { error: "Website must be a valid http:// or https:// address." };
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Website must start with http:// or https://." };
    }
    if (!parsed.hostname || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) {
      return { error: "Enter a valid website address (for example https://example.org)." };
    }
    return { value: hasScheme ? parsed.toString() : candidate };
  } catch {
    return { error: "Enter a valid website address (for example https://example.org)." };
  }
}

function isValidEmailList(raw: string, allowMultiple: boolean): boolean {
  const parts = allowMultiple
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [raw];
  return parts.length > 0 && parts.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function safeActionError(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code;
  if (code === "23505") return "A record with those details already exists.";
  if (code === "23503") return "The selected group no longer exists.";
  if (code === "22P02" || code === "22003") return "Invalid identifier provided.";
  console.error("Stakeholder action error:", error);
  return fallback;
}

export async function saveStakeholderAction(
  _prev: StakeholderState,
  formData: FormData,
): Promise<StakeholderState> {
  try {
    const user = await assertPermission("stakeholders.manage");

    const rawId = String(formData.get("id") ?? "").trim();
    const id = rawId ? parsePositiveInt(rawId) : null;
    if (rawId && !id) return { error: "Invalid stakeholder ID." };

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Enter a name." };

    const email = text(formData, "email");
    if (email && !isValidEmailList(email, false)) {
      return { error: "Enter a valid primary email address." };
    }
    const altEmail = text(formData, "alt_email");
    if (altEmail && !isValidEmailList(altEmail, true)) {
      return { error: "Enter valid alternate email address(es)." };
    }

    const websiteCheck = normalizeWebsite(text(formData, "website"));
    if ("error" in websiteCheck) return { error: websiteCheck.error };

    let groupId: number | null = null;
    const newGroupName = String(formData.get("new_group_name") ?? "").trim();
    if (newGroupName) {
      const [existingGroup] = await sql<{ id: number }[]>`
        SELECT id FROM stakeholder_groups WHERE lower(name) = ${newGroupName.toLowerCase()} LIMIT 1`;
      if (existingGroup) {
        groupId = existingGroup.id;
      } else {
        try {
          const [createdGroup] = await sql<{ id: number }[]>`
            INSERT INTO stakeholder_groups (name) VALUES (${newGroupName}) RETURNING id`;
          groupId = createdGroup.id;
          await recordAudit({
            user,
            action: "CREATE",
            entity: "stakeholder_group",
            entityId: createdGroup.id,
            details: newGroupName,
          });
        } catch (err) {
          if ((err as { code?: string })?.code === "23505") {
            const [raceGroup] = await sql<{ id: number }[]>`
              SELECT id FROM stakeholder_groups WHERE lower(name) = ${newGroupName.toLowerCase()} LIMIT 1`;
            if (raceGroup) groupId = raceGroup.id;
            else throw err;
          } else {
            throw err;
          }
        }
      }
    } else {
      const rawGroupId = String(formData.get("group_id") ?? "").trim();
      if (rawGroupId) {
        groupId = parsePositiveInt(rawGroupId);
        if (!groupId) return { error: "Invalid group selected." };
        const [groupExists] = await sql<{ id: number }[]>`
          SELECT id FROM stakeholder_groups WHERE id = ${groupId} LIMIT 1`;
        if (!groupExists) return { error: "The selected group no longer exists." };
      }
    }

    const fields = {
      organisation: text(formData, "organisation"),
      job_title: text(formData, "job_title"),
      email,
      alt_email: altEmail,
      phone: text(formData, "phone"),
      alt_phone: text(formData, "alt_phone"),
      location: text(formData, "location"),
      gender: text(formData, "gender"),
      age_group: text(formData, "age_group"),
      website: websiteCheck.value,
      social: text(formData, "social"),
      notes: text(formData, "notes"),
    };

    const [dupe] = await sql<{ id: number }[]>`
      SELECT id FROM stakeholders
      WHERE lower(name) = ${name.toLowerCase()}
        AND COALESCE(lower(email), '') = ${(fields.email ?? "").toLowerCase()}
        AND (
          group_id IS NOT DISTINCT FROM ${groupId}
          OR ${Boolean(fields.email)}
        )
        ${id ? sql`AND id <> ${id}` : sql``}
      LIMIT 1`;
    if (dupe) {
      return {
        error: fields.email
          ? "A stakeholder with this name and email already exists."
          : "A stakeholder with this name already exists in that group.",
      };
    }

    let savedId: number;
    if (id) {
      const [updated] = await sql<{ id: number }[]>`
        UPDATE stakeholders SET
          name = ${name}, organisation = ${fields.organisation}, job_title = ${fields.job_title},
          email = ${fields.email}, alt_email = ${fields.alt_email},
          phone = ${fields.phone}, alt_phone = ${fields.alt_phone},
          location = ${fields.location}, gender = ${fields.gender},
          age_group = ${fields.age_group}, website = ${fields.website},
          social = ${fields.social}, notes = ${fields.notes},
          group_id = ${groupId}, updated_at = now()
        WHERE id = ${id}
        RETURNING id`;
      if (!updated) return { error: "That stakeholder no longer exists." };
      savedId = updated.id;
      await recordAudit({ user, action: "UPDATE", entity: "stakeholder", entityId: savedId, details: name });
    } else {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO stakeholders (name, organisation, job_title, email, alt_email, phone,
                                  alt_phone, location, gender, age_group, website, social,
                                  notes, group_id)
        VALUES (${name}, ${fields.organisation}, ${fields.job_title}, ${fields.email},
                ${fields.alt_email}, ${fields.phone}, ${fields.alt_phone}, ${fields.location},
                ${fields.gender}, ${fields.age_group}, ${fields.website}, ${fields.social},
                ${fields.notes}, ${groupId})
        RETURNING id`;
      savedId = row.id;
      await recordAudit({
        user,
        action: "CREATE",
        entity: "stakeholder",
        entityId: savedId,
        details: name,
      });
    }

    revalidatePath("/stakeholders");
    revalidatePath(`/stakeholders/${savedId}`);
    revalidatePath("/dashboard");
    revalidatePath("/taxonomy");
    return { ok: true };
  } catch (error) {
    return { error: safeActionError(error, "Could not save that stakeholder.") };
  }
}

export async function deleteStakeholderAction(
  _prev: StakeholderState,
  formData: FormData,
): Promise<StakeholderState> {
  try {
    const user = await assertPermission("stakeholders.manage");
    const id = parsePositiveInt(formData.get("id"));
    if (!id) return { error: "Nothing selected." };

    const [row] = await sql<{ name: string }[]>`
      DELETE FROM stakeholders WHERE id = ${id} RETURNING name`;
    if (!row) return { error: "That stakeholder no longer exists." };

    await recordAudit({
      user,
      action: "DELETE",
      entity: "stakeholder",
      entityId: id,
      details: row.name,
    });

    revalidatePath("/stakeholders");
    revalidatePath(`/stakeholders/${id}`);
    revalidatePath("/dashboard");
    revalidatePath("/taxonomy");
    return { ok: true };
  } catch (error) {
    return { error: safeActionError(error, "Could not delete that stakeholder.") };
  }
}

/**
 * Creates a stakeholder group from inside the contact form, so somebody filing
 * a contact under a group that does not exist yet does not have to abandon the
 * form, go to Lists, and start again.
 */
export async function createGroupAction(
  _prev: StakeholderState & { groupId?: number },
  formData: FormData,
): Promise<StakeholderState & { groupId?: number }> {
  try {
    const user = await assertPermission("stakeholders.manage");
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Enter a group name." };

    const [existing] = await sql<{ id: number }[]>`
      SELECT id FROM stakeholder_groups WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`;
    if (existing) return { ok: true, groupId: existing.id };

    try {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO stakeholder_groups (name) VALUES (${name}) RETURNING id`;
      await recordAudit({
        user,
        action: "CREATE",
        entity: "stakeholder_group",
        entityId: row.id,
        details: name,
      });

      revalidatePath("/stakeholders");
      revalidatePath("/taxonomy");
      revalidatePath("/dashboard");
      return { ok: true, groupId: row.id };
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        const [race] = await sql<{ id: number }[]>`
          SELECT id FROM stakeholder_groups WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`;
        if (race) return { ok: true, groupId: race.id };
        return { error: "A group with that name already exists." };
      }
      throw err;
    }
  } catch (error) {
    return { error: safeActionError(error, "Could not create the group.") };
  }
}
